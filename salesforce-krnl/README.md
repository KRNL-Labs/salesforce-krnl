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
- `/api/access` and `/api/access/init` – document access logging.
- `/api/view` – secure PDF/asset viewer used by the KRNL HTML viewer.
- `/api/compliance` and `/api/documents/register-direct` – document registration/compliance.

With these pieces configured, a new scratch org + running backend can:

- Upload files directly to Supabase/S3 via LWC.
- Register documents on-chain via KRNL.
- Log access events and show them in the record-level KRNL card.
