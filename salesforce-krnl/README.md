# Salesforce DX Project: Next Steps

Now that you’ve created a Salesforce DX project, what’s next? Here are some documentation resources to get you started.

## How Do You Plan to Deploy Your Changes?

Do you want to deploy a set of changes, or create a self-contained application? Choose a [development model](https://developer.salesforce.com/tools/vscode/en/user-guide/development-models).

## Configure Your Salesforce DX Project

The `sfdx-project.json` file contains useful configuration information for your project. See [Salesforce DX Project Configuration](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm) in the _Salesforce DX Developer Guide_ for details about this file.

## Read All About It

- [Salesforce Extensions Documentation](https://developer.salesforce.com/tools/vscode/)
- [Salesforce CLI Setup Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference.htm)

---

## KRNL Document Access & Compliance Setup

This project includes a KRNL-backed document access and compliance flow that spans:

- Salesforce LWCs and Apex classes.
- A Node.js backend (this repo's `backend/` folder).
- On-chain logging via KRNL and a smart contract.

Use this section as a quick checklist to get a new scratch org + backend wired up.

### 1. Backend `.env` configuration

In `backend/.env` set at minimum:

- `PUBLIC_BASE_URL=https://<your-ngrok-or-deployed-url>`
- `PORT=3000` (or your chosen port)
- `JWT_SECRET=<any strong random string>`
- `KRNL_NODE_URL=https://node.krnl.xyz`

Then start the backend:

```bash
cd backend
npm install
npm start
```

If you use ngrok, expose the port and update `PUBLIC_BASE_URL` to the ngrok HTTPS URL.

### 2. Salesforce Named Credential

The Apex class `DocumentAccessLogger` uses a Named Credential called `krnl_blockchain_endpoint`:

```apex
private static final String BLOCKCHAIN_ENDPOINT = 'krnl_blockchain_endpoint';
```

Create a **Named Credential (Legacy)** in Setup:

- **Name**: `krnl_blockchain_endpoint`
- **URL**: `https://<your-ngrok-or-deployed-url>` (matches `PUBLIC_BASE_URL`)
- **Identity Type**: Named Principal
- **Authentication Protocol**: No Authentication

This is used for all Apex callouts to the backend, including:

- `/api/uploads/init` (direct uploads)
- `/api/access` and `/api/access/init` (access logging)
- `/api/files/viewer-url` (signed viewer URLs)
- `/api/compliance` and `/api/documents/register-direct` (registration/compliance)

### 3. CSP Trusted Site for LWC `fetch`

The `directUploadToBackend` LWC uploads files via `fetch(uploadUrl, { method: 'PUT', ... })`.

In **Setup → CSP Trusted Sites**:

- New Trusted Site:
  - **Trusted Site Name**: `KRNL_Backend`
  - **Trusted Site URL**: `https://<your-ngrok-or-deployed-url>`
  - Enable **Connect-src** (so LWC JavaScript can call the backend).

Use the same base URL as `PUBLIC_BASE_URL` and the Named Credential.

### 4. Deploy Salesforce metadata to a scratch org

From the `salesforce-krnl/salesforce-krnl` folder:

```bash
sf org create scratch \
  --definition-file config/project-scratch-def.json \
  --alias scratchOrg \
  --duration-days 7 \
  --set-default \
  --target-dev-hub <your-dev-hub-alias-or-username>

sf project deploy start \
  --source-dir force-app/main/default \
  --target-org scratchOrg
```

### 5. Place KRNL components on record pages

**Main KRNL card** – `documentAccessTracker` LWC:

- Exposed to `lightning__RecordPage`, `lightning__AppPage`, `lightning__HomePage`, and `lightning__Tab`.
- Shows:
  - Direct upload section (`directUploadToBackend` nested inside).
  - Uploaded Files for this Record (from `Blockchain_Document__c`).
  - Access History (from `Document_Access_Log__c`).

To add it to an object record page:

1. Go to **Setup → Object Manager → <Object> → Lightning Record Pages**.
2. Edit (or create) a record page.
3. In Lightning App Builder, drag **Document Access Tracker** onto the layout.
4. Save and Activate.

**Standalone upload** – `directUploadToBackend` LWC:

- Also available as a separate component if you want just the upload area on a page.

### 6. Apex classes involved

- `DocumentAccessLogger`
  - Handles direct uploads, viewer URLs, access logging, blockchain registration.
  - Performs callouts to the backend using `krnl_blockchain_endpoint`.
- `DocumentAccessController`
  - Provides LWC data:
    - Compliance stats (`getComplianceStats`).
    - Recent activity (`getRecentActivity`).
    - Per-record uploads (`getUploadsForRecord`).
    - Per-record access logs (`getDocumentAccessLogs`).

### 7. Backend endpoints (quick reference)

- `/api/uploads/init` – start a direct upload session from Apex.
- `/api/uploads/:uploadId/file` – LWC binary upload using signed URL.
- `/api/files/viewer-url` – signed Supabase/S3 file URL.
- `/api/access` – synchronous access logging that returns a ready-to-use viewer URL.
- `/api/access/init` – **session-first** access logging; starts a KRNL workflow and returns a `sessionId` + `viewerSessionUrl`.
- `/api/access/session/:sessionId` – Salesforce-authenticated session status (used by Apex to sync access logs).
- `/api/access/public-session/:sessionId` – public session status (used by the secure viewer tab for polling).
- `/api/access/token` – returns a signed viewer token once a session has completed on-chain.
- `/api/view` – secure PDF/asset viewer used by the KRNL HTML viewer.
- `/api/compliance` and `/api/documents/register-direct` – document registration/compliance.

With these pieces configured, a new scratch org + running backend can:

- Upload files directly to Supabase/S3 via LWC.
- Register documents on-chain via KRNL.
- Log access events and show them in the record-level KRNL card.

### 8. Session-first secure viewer & access history (architecture)

The **session-first** flow opens the secure viewer immediately in a new tab, while KRNL and the
blockchain workflow run in the background. Salesforce later pulls the final `accessHash` and
blockchain status using the KRNL `sessionId`.

#### Components

- **LWC `documentAccessTracker`**
  - Shows direct uploads, access history, and opens the secure viewer.
- **Apex `DocumentAccessLogger`**
  - Starts access logging via `/api/access/init` and creates `Document_Access_Log__c` rows.
- **Apex `DocumentAccessController`**
  - Provides access history to LWCs and exposes `syncAccessLogsForRecord` to refresh queued logs.
- **Node backend (`backend/`)**
  - Orchestrates KRNL workflows, tracks in-memory sessions, and serves the HTML secure viewer.
- **KRNL node + `DocumentAccessRegistry` contract**
  - Executes the access logging workflow and emits `DocumentAccessLogged` events containing
    `documentId` and `accessHash`.
- **Salesforce objects**
  - `Blockchain_Document__c` – registered documents.
  - `Document_Access_Log__c` – per-access audit records shown in Access History.

#### End-to-end flow (session-first viewer)

```mermaid
sequenceDiagram
    participant U as User (Salesforce UI)
    participant L as LWC documentAccessTracker
    participant A as Apex DocumentAccessLogger
    participant B as KRNL Backend (/api/access)
    participant K as KRNL Node + Contract
    participant S as Salesforce Access Logs

    U->>L: Click "View" on uploaded document
    L->>A: getViewerSessionUrlForDirectUpload(blockchainDocId, path, 'view')
    A->>B: POST /api/access/init { documentHash, recordId, userId, accessType, ... }
    B->>K: Start KRNL access logging workflow
    B-->>A: { sessionId, viewerSessionUrl, ... }
    A->>S: insert Document_Access_Log__c(
        Status__c='Queued for Blockchain',
        Blockchain_Response__c = raw /api/access/init response (includes sessionId)
    )
    A-->>L: viewerSessionUrl
    L->>U: Open new tab /secure-viewer?sessionId=...

    loop While KRNL workflow is running
        Viewer->>B: GET /api/access/public-session/:sessionId
        B->>K: Poll workflow & blockchain
        K-->>B: status + (optional) txHash
        B-->>Viewer: { status, progress }
    end

    B-->>Viewer: Session ready with accessHash
    Viewer->>B: POST /api/access/token { sessionId }
    B-->>Viewer: { accessToken, viewerUrl }
    Viewer->>U: Render protected PDF with watermark and controls disabled

    U->>L: Re-open record / refresh KRNL card
    L->>A: syncAccessLogsForRecord(recordId)
    A->>S: Query Document_Access_Log__c rows with Status__c='Queued for Blockchain'
    A->>B: GET /api/access/session/:sessionId (from Blockchain_Response__c)
    B-->>A: { status, documentId, accessHash, txHash }
    A->>S: update Document_Access_Log__c(
        Status__c='Logged to Blockchain',
        Blockchain_Response__c = latest backend response including accessHash
    )
    L->>A: getDocumentAccessLogs(documentId)
    A-->>L: AccessLogWrapper records with fileName, accessHash, blockchainStatus
    L->>U: Access History shows Logged to Blockchain + accessHash
```

#### Notes and limitations

- **In-memory sessions**: The backend tracks sessions in an in-memory `Map`, shared across
  KRNLService instances in a single Node process. Restarting the backend clears active sessions,
  so very long-running workflows should be completed before restarts.
- **No backend→Salesforce writes**: The backend never calls Salesforce directly. All updates to
  `Document_Access_Log__c` are performed by Apex (`syncAccessLogsForRecord` / `syncSingleAccessLog`).
- **Multi-org friendly**: Each org only needs the `krnl_blockchain_endpoint` Named Credential and
  CSP Trusted Site. There is no org-specific token stored in the backend `.env` for the
  session-first flow.
