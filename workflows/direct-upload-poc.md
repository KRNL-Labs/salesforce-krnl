# Direct LWC → Backend Upload POC

## 1. Scope & Goals

This document describes the proof-of-concept (POC) that enables **direct file upload from a Salesforce LWC to the KRNL backend**, without using `ContentDocument` as an intermediate storage layer.

The goals are:

- Allow a Lightning Web Component on a **record page** to send files directly to the backend.
- Keep the **backend** as the source of truth for:
  - Canonical SHA-256 document hashes.
  - Optional file storage in Supabase.
- Preserve a **strong security posture** by:
  - Avoiding exposure of backend secrets or storage credentials to the browser.
  - Authenticating all uploads via Salesforce sessions and short-lived JWTs.

This POC is designed as a building block for KRNL document registration and access workflows.

---

## 2. High-Level Architecture

### 2.1 Actors

- **Salesforce LWC**: `directUploadToBackend`
  - Placed on a `lightning__RecordPage` (e.g. Account).
  - Receives `recordId` from the Lightning framework.
- **Apex**: `DocumentAccessLogger.initDirectUpload`
  - Server-side bridge between Salesforce and the KRNL backend.
  - Uses Named Credential `krnl_blockchain_endpoint`.
- **KRNL Backend (Node/Express)**
  - Endpoints:
    - `POST /api/uploads/init` – mint upload session + signed URL.
    - `PUT /api/uploads/:uploadId/file` – accept and hash file bytes.
  - Uses `fileStorageService.storeFileAndHash` for hashing and optional Supabase storage.
- **Supabase (optional)**
  - Long-term object storage for document bytes.

### 2.2 Sequence Overview

1. **User action**: In the `directUploadToBackend` card, user selects a file and clicks **Upload to Backend**.
2. **LWC → Apex**: LWC calls `DocumentAccessLogger.initDirectUpload(recordId)`.
3. **Apex → Backend** (`/api/uploads/init`):
   - Sends `{ recordId, userId }` and `X-Salesforce-Token` (Salesforce session ID) via Named Credential.
   - Backend validates the Salesforce session (via `validateSalesforceToken`).
4. **Backend**:
   - Issues a unique `uploadId`.
   - Signs a **JWT** containing `{ uploadId, recordId, userId }` with `JWT_SECRET`.
   - Returns a signed **upload URL**:
     - `PUBLIC_BASE_URL/api/uploads/:uploadId/file?token=<jwt>`.
5. **Apex → LWC**: Returns the `uploadUrl` to the LWC.
6. **LWC → Backend** (`PUT /api/uploads/:uploadId/file`):
   - Sends an HTTP `PUT` with the selected `File` as the body.
   - Adds headers:
     - `Content-Type: application/octet-stream`
     - `X-File-Name: <browserFileName>`
7. **Backend upload endpoint**:
   - Parses the body as raw binary (`express.raw`).
   - Verifies the JWT from `token` query param.
   - Ensures `decoded.uploadId` matches the `:uploadId` path param.
   - Calls `storeFileAndHash({ buffer, contentDocumentId: recordId, fileName, contentType })`.
   - Returns `{ success, uploadId, recordId, userId, hash, storage }`.
8. **LWC**:
   - On success, shows a toast and displays the `hash` (and storage path if configured).

---

## 3. Backend Design

### 3.1 Environment Configuration

Key environment variables (in `backend/.env`):

```env
# Public URL used to construct absolute upload URLs
PUBLIC_BASE_URL=https://<your-ngrok-or-reverse-proxy-url>

# Secret for signing JWTs used in upload URLs
JWT_SECRET=<strong-random-string>

# Optional Supabase configuration for storage
SUPABASE_URL=<supabase-url>
SUPABASE_SERVICE_KEY=<supabase-service-key>
SUPABASE_BUCKET=documents

# Max upload size
MAX_FILE_UPLOAD_BYTES=10485760  # 10 MB
```

### 3.2 Raw Body Parser

To support binary bodies from both Apex and LWC, the backend configures:

```js
const rawFileBody = express.raw({
  type: () => true,
  limit: process.env.MAX_FILE_UPLOAD_BYTES || '10485760'
});
```

- This parser is **only** attached to the upload routes (`/api/files/upload` and `/api/uploads/:uploadId/file`).
- It ensures `req.body` is always a Node `Buffer` for those endpoints, independent of the `Content-Type` the client sends.

### 3.3 `POST /api/uploads/init`

Responsibilities:

- Authenticate request using `validateSalesforceToken`.
- Validate required field: `recordId`.
- Generate `uploadId` and sign a JWT:
  - Claims: `{ uploadId, recordId, userId }`.
  - TTL: `UPLOAD_TOKEN_TTL_SECONDS` (default: 900 seconds).
- Build `uploadUrl` and `uploadPath` using `PUBLIC_BASE_URL`.
- Return `{ uploadId, uploadUrl, uploadPath, expiresInSeconds }`.

### 3.4 `PUT /api/uploads/:uploadId/file`

Responsibilities:

- Extract `token` query parameter.
- Verify JWT using `JWT_SECRET`.
- Ensure `decoded.uploadId` matches `req.params.uploadId`.
- Validate body (`Buffer` and non-empty).
- Derive metadata:
  - `fileName` from `X-File-Name` header.
  - `contentType` from `Content-Type` header.
- Call `storeFileAndHash` to:
  - Compute canonical SHA-256 hash of the bytes.
  - Optionally push the bytes into Supabase storage (bucket + path derived from `recordId` and filename).
- Return `{ success, uploadId, recordId, userId, hash, storage }`.

If Supabase is *not* configured, the backend logs:

> Supabase client not initialized, skipping upload but returning hash

and returns `storage: null` while still providing the canonical hash.

### 3.5 Data Path & Hash Derivation

This section ties together **how the file bytes move** from the browser to storage and **exactly how** the canonical hash is produced.

#### 3.5.1 Transport: Browser → Backend → Supabase

- **Browser (LWC)**
  - The selected `File` object is passed directly as the `body` of the `fetch` `PUT` request.
  - No base64 encoding is performed in the browser; bytes are sent as‑is over HTTPS.
  - Headers:
    - `Content-Type: application/octet-stream`
    - `X-File-Name: <original-file-name>`

- **Backend (Express)**
  - The upload route is decorated with `express.raw({ type: () => true, ... })` so `req.body` is a Node `Buffer` containing the raw bytes from the LWC.
  - The signed JWT in the `token` query parameter is verified and used to recover `uploadId`, `recordId`, and `userId`.
  - The backend calls `storeFileAndHash({ buffer, contentDocumentId: recordId, fileName, contentType })` to persist and hash the file.

- **Supabase (optional)**
  - If Supabase is configured, the file is stored under:
    - `bucket = SUPABASE_BUCKET` (default: `documents`)
    - `path = <recordId>/<sanitizedFileName>`
  - The `sanitizedFileName` is derived from the browser filename with non `[A-Za-z0-9._-]` characters replaced by `_`.
  - The backend returns this as `storage: { bucket, path }` to the LWC for reference.

#### 3.5.2 Canonical Hash Computation

Hashing is performed centrally in `fileStorageService.storeFileAndHash`:

- Input: the raw `Buffer` of file bytes (`params.buffer`).
- Algorithm: **SHA-256** over the exact byte sequence received from the client.

```js
const hashHex = crypto.createHash('sha256').update(buffer).digest('hex');
const hash = `0x${hashHex}`;
```

- The resulting canonical hash:
  - Is a 32‑byte SHA-256 digest, hex‑encoded.
  - Is prefixed with `0x` to match the style used throughout the KRNL/backend and on‑chain interactions.
  - Is intended to be passed unchanged as the `documentHash` string into downstream KRNL workflows and ultimately into the `DocumentAccessRegistry` contract (e.g. `DocumentRegistrationParams.documentHash`).

- If Supabase is **not** configured, the function still computes the hash and returns:

  ```json
  {
    "hash": "0x<sha256-hex>",
    "storage": null
  }
  ```

This ensures that the **hash used for on‑chain registration is always derived from the exact bytes** uploaded via the LWC, regardless of whether object storage is enabled.

---

## 4. Salesforce-Apex Integration

### 4.1 `DocumentAccessLogger.initDirectUpload`

- Accepts a Salesforce `recordId`.
- Uses Named Credential `krnl_blockchain_endpoint` to call the backend.
- Sends:
  - JSON body `{ recordId, userId }`.
  - `X-Salesforce-Token` header populated with `UserInfo.getSessionId()`.
- Returns the `uploadUrl` string to the LWC.

This method **does not** handle any file bytes itself; it only bootstraps an upload session.


---

## 5. LWC `directUploadToBackend`

### 5.1 Responsibilities

- Collect a file from the user via `<lightning-input type="file">`.
- Require presence of `recordId` (enforced by placing the component on a record page).
- Request an upload URL via Apex.
- Send the file bytes to the backend using `fetch`.
- Display the resulting hash (and storage path) to the user.

### 5.2 Placement

- Exposed via `directUploadToBackend.js-meta.xml` on:
  - `lightning__RecordPage`
  - `lightning__AppPage`
- Typical placement: Account/Opportunity/custom object record page for testing.

---

## 6. Security Posture

This POC is intentionally designed with a conservative security posture across multiple layers.

### 6.1 Trust Model & Boundaries

- **Salesforce Org**
  - Authenticates users via standard Salesforce identity mechanisms.
  - Holds the `recordId` context and ensures the user has access to the record.
- **KRNL Backend**
  - Trusted to compute canonical hashes and manage storage.
  - Validates Salesforce-originated requests using `X-Salesforce-Token` and a Named Credential.
- **Browser (LWC)**
  - Considered an untrusted environment, so **no secrets or backend keys** are exposed.
  - Only receives **opaque upload URLs** (with signed JWTs) and non-sensitive results (hashes, paths).

### 6.2 Authentication & Authorization

**Salesforce → Backend:**

- Communication uses a **Named Credential** (`krnl_blockchain_endpoint`).
- Apex passes `UserInfo.getSessionId()` in `X-Salesforce-Token`.
- Backend `validateSalesforceToken` can (in production) validate this against Salesforce to:
  - Confirm session is valid.
  - Obtain user/org metadata.
- This ensures only authenticated Salesforce code can open upload sessions.

**LWC → Backend (upload URL):**

- The LWC never sees `JWT_SECRET` or any storage credentials.
- It only gets a **time-limited, per-upload signed URL** from Apex.
- The JWT includes:
  - `uploadId` – strongly binds token to a single upload session.
  - `recordId`, `userId` – context for server-side logging and enforcement.
- Backend verifies the JWT and checks that `decoded.uploadId` matches the URL path param.
  - Prevents token reuse across different upload IDs.

### 6.3 JWT Security

- Tokens are signed with `JWT_SECRET` (keep this out of source control and rotate as needed).
- Short TTL (`UPLOAD_TOKEN_TTL_SECONDS`, default 15 minutes) reduces risk of token replay.
- Tokens are only ever passed as a **query parameter** in URLs returned from Apex, and only used once per upload.

Recommendations for production:

- Use a strong, randomly-generated `JWT_SECRET` and rotate periodically.
- Consider binding tokens to the Salesforce org ID or additional context if needed.
- Implement logging/alerting for repeated JWT validation failures.

### 6.4 Data Handling & Privacy

- **On-chain**: only content hashes are ever intended to be pushed to contracts, not document bodies.
- **Backend**:
  - Receives raw bytes only over TLS (`https://PUBLIC_BASE_URL`).
  - Computes SHA-256 hashes; these do not reveal document contents.
- **Supabase (optional)**:
  - Stores file bytes under a bucket and path derived from `recordId` and sanitized filename.
  - The returned `storage` object **never exposes** Supabase keys to the client.

No secrets or private keys are stored in the browser or in LWC source.

### 6.5 Transport Security

- All Salesforce ↔ backend communications traverse HTTPS:
  - Named Credential uses `https://PUBLIC_BASE_URL`.
  - LWC uses `fetch` to the same HTTPS base.
- ngrok (in dev) terminates TLS; production should use a proper TLS-terminated reverse proxy or load balancer.

### 6.6 Supabase & Storage Security

When enabled:

- Supabase credentials (`SUPABASE_SERVICE_KEY`) are only present in the backend `.env`.
- The client only receives **bucket** and **path**, never keys or signed URLs.
- Recommended:
  - Use **Row-Level Security (RLS)** or bucket policies that require backend mediation.
  - Restrict bucket to the minimal scope required for this use case.
  - Implement retention policies and lifecycle rules for uploaded documents.

### 6.7 Logging & Observability

- Backend logs for uploads include:
  - `uploadId`, `recordId`, `userId`, `hash`, and storage location.
- Sensitive payloads (full file contents) are **never logged**.
- Logs enable:
  - Auditing which record/user uploaded which file.
  - Correlation with subsequent KRNL workflows or on-chain registrations.

### 6.8 Hardening Recommendations (Beyond POC)

- **Input validation**:
  - Enforce file size limits server-side (already parameterized via `MAX_FILE_UPLOAD_BYTES`).
  - Restrict allowed MIME types or file extensions according to business rules.
- **Malware scanning**:
  - Integrate an antivirus/malware scanning step for uploaded files before further processing.
- **Rate limiting**:
  - Introduce rate limits per user/record/IP on `/api/uploads/*` to prevent abuse.
- **Permissions**:
  - Gate `initDirectUpload` behind a **custom permission** and record-level checks to ensure only authorized users can upload for a given record.
- **Error handling**:
  - Normalize error responses so the LWC can display user-friendly messages while avoiding leakage of sensitive backend details.

---

## 7. How This Integrates with KRNL Workflows

This POC is intentionally isolated from the existing KRNL workflows, but is designed to plug into them:

- The canonical `hash` returned from a direct upload can be passed as `DOCUMENT_HASH` into
  `document-registration-workflow.json`.
- `recordId` can be used as `salesforceRecordId` (or mapped to `DOCUMENT_ID`) in the workflow
  parameters.
- Supabase `storage` metadata can be attached to `Blockchain_Document__c` or other Salesforce
  records for traceability.

Future work includes wiring the upload result into:

- `/api/compliance` → KRNL EIP-4337 workflow invocation.
- Salesforce blockchain registry objects (`Blockchain_Document__c`).
- Access logging and integrity validation flows.
