# KRNL Document Access & Compliance Workflows

This directory contains KRNL workflow configurations for the Salesforce Document Access & Compliance system. These workflows integrate Salesforce with blockchain technology for secure document management and compliance tracking.

## Architecture Overview

The system uses KRNL's workflow orchestration to create a bridge between Salesforce and blockchain networks, enabling:

- **Document Registration**: Register Salesforce documents on blockchain
- **Access Logging**: Log all document access events with compliance tracking
- **Integrity Validation**: Validate document integrity against blockchain records

## Workflow Configurations

### 1. Document Registration (`document-registration-workflow.json`)

Registers Salesforce documents on the blockchain for immutable tracking.

**Workflow Steps:**
1. **fetch-salesforce-document**: Retrieves document metadata from Salesforce
2. **fetch-document-content**: Gets document binary content
3. **generate-document-hash**: Creates SHA-256 hash of document + metadata
4. **prepare-document-metadata**: Encodes metadata for blockchain storage
5. **validate-compliance**: Checks document against compliance rules
6. **register-on-blockchain**: Registers document on DocumentAccessRegistry contract
7. **update-salesforce-record**: Creates blockchain record in Salesforce

**Usage:**
```typescript
import { useKRNL } from '@krnl-dev/sdk-react-4337';
import documentRegistrationWorkflow from './document-registration-workflow.json';

const { executeWorkflowFromTemplate } = useKRNL();

await executeWorkflowFromTemplate(documentRegistrationWorkflow, {
  '{{ENV.SENDER_ADDRESS}}': smartAccountAddress,
  '{{ENV.DOCUMENT_REGISTRY_CONTRACT}}': contractAddress,
  '{{DOCUMENT_ID}}': salesforceDocumentId,
  '{{SALESFORCE_ACCESS_TOKEN}}': accessToken,
  '{{USER_SIGNATURE}}': signedIntent
});
```

### 2. Document Access Logging (`document-access-logging-workflow.json`)

Logs every document access event on blockchain for compliance and audit trails.

**Workflow Steps:**
1. **validate-document-exists**: Confirms document exists in Salesforce
2. **get-user-info**: Retrieves user information from Salesforce
3. **capture-access-context**: Captures session and device context
4. **validate-access-permissions**: Checks user permissions
5. **check-compliance-rules**: Validates against compliance frameworks
6. **prepare-access-log**: Encodes access data for blockchain
7. **log-to-blockchain**: Logs access event on blockchain
8. **create-salesforce-access-log**: Creates audit record in Salesforce
9. **send-compliance-notification**: Sends alerts if needed

**Integration with LWC:**
```javascript
// In documentAccessTracker LWC component
async logAndExecuteAccess(accessType, callback) {
    const { executeWorkflowFromTemplate } = useKRNL();

    await executeWorkflowFromTemplate(accessLoggingWorkflow, {
        '{{DOCUMENT_ID}}': this.selectedDocumentId,
        '{{ACCESS_TYPE}}': accessType,
        '{{USER_ID}}': this.currentUserId,
        '{{CLIENT_IP}}': this.getClientIP(),
        '{{USER_AGENT}}': navigator.userAgent
    });

    if (callback) callback();
}
```

### 3. Document Integrity Validation (`document-integrity-validation-workflow.json`)

Validates document integrity by comparing current document hash with blockchain records.

**Workflow Steps:**
1. **fetch-current-document**: Gets current document from Salesforce
2. **get-current-version-data**: Retrieves current document content
3. **generate-current-hash**: Creates hash of current document
4. **fetch-blockchain-record**: Gets stored hash from blockchain
5. **fetch-salesforce-blockchain-record**: Gets Salesforce blockchain record
6. **compare-hashes**: Compares all hash values
7. **validate-document-integrity**: Performs integrity analysis
8. **generate-validation-report**: Creates detailed validation report
9. **update-validation-record**: Stores validation results
10. **send-integrity-alert**: Sends alerts if tampering detected

## Configuration Files

### `krnl-config.json`

Main configuration file containing:
- **KRNL Node settings**: Network, factory address, app secret
- **Contract addresses**: DocumentAccessRegistry and related contracts
- **Salesforce configuration**: Instance URL, API version, object mappings
- **Executor images**: Pre-built KRNL executors for different tasks
- **Compliance rules**: File size limits, allowed types, regulatory frameworks
- **Notification settings**: Email addresses, Slack webhooks, alert thresholds

## Integration Patterns

### LWC Integration

```javascript
// documentAccessTracker.js
import { LightningElement, api } from 'lwc';
import { useKRNL, useKRNLAuth } from '@krnl-dev/sdk-react-4337';

export default class DocumentAccessTracker extends LightningElement {
    @api recordId;

    async handleDocumentAccess(event) {
        const accessType = event.target.dataset.action;

        // 1. Sign transaction intent
        const intent = this.createTransactionIntent(accessType);
        const signature = await this.signIntent(intent);

        // 2. Execute KRNL workflow
        const workflow = await this.loadWorkflow('document-access-logging');
        const parameters = this.createWorkflowParameters(signature);

        await this.executeWorkflow(workflow, parameters);

        // 3. Execute actual document action
        this.performDocumentAction(accessType);
    }
}
```

### Salesforce Apex Integration

```apex
// DocumentKRNLIntegration.cls
public with sharing class DocumentKRNLIntegration {

    @future(callout=true)
    public static void registerDocumentAsync(Id documentId) {
        // Create KRNL workflow callout
        KRNLWorkflowService.executeWorkflow('document-registration', new Map<String, Object>{
            'DOCUMENT_ID' => documentId,
            'SALESFORCE_ACCESS_TOKEN' => getAccessToken(),
            'SALESFORCE_INSTANCE_URL' => URL.getSalesforceBaseUrl().toExternalForm()
        });
    }
}
```

## Environment Variables

Required environment variables for workflow execution:

```env
# KRNL Configuration
KRNL_NODE_URL=https://node.krnl.xyz
FACTORY_ADDRESS=0x...
APP_SECRET=your-app-secret

# Blockchain
DOCUMENT_REGISTRY_CONTRACT_ADDRESS=0x...
TARGET_CONTRACT_OWNER=0x...
ATTESTOR_ADDRESS=0x...

# Salesforce
SALESFORCE_INSTANCE_URL=https://yourorg.my.salesforce.com
SALESFORCE_ACCESS_TOKEN=your-token

# Infrastructure
RPC_SEPOLIA_URL=https://sepolia.infura.io/v3/...
PIMLICO_API_KEY=your-pimlico-key

# Notifications
COMPLIANCE_TEAM_EMAIL=compliance@yourorg.com
SECURITY_TEAM_EMAIL=security@yourorg.com
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

## Deployment

1. **Deploy Smart Contracts**: Deploy DocumentAccessRegistry to Sepolia
2. **Configure KRNL Node**: Set up attestor and executor permissions
3. **Update Salesforce**: Deploy Apex classes and LWC components
4. **Environment Setup**: Configure all required environment variables
5. **Test Workflows**: Run test scenarios to validate integration

## Monitoring & Alerting

The workflows include built-in monitoring:

- **Real-time status updates** via KRNL SDK hooks
- **Compliance score tracking** with configurable thresholds
- **Integrity validation alerts** for potential tampering
- **Failed workflow notifications** for operational issues

## Security Considerations

- **Access Control**: Role-based permissions in both Salesforce and blockchain
- **Data Privacy**: Sensitive data stays in Salesforce, only hashes on blockchain
- **Audit Trail**: Complete immutable audit trail on blockchain
- **Encryption**: All communications encrypted in transit
- **Key Management**: Smart account keys managed by KRNL infrastructure

## Compliance Frameworks

Workflows support multiple regulatory frameworks:
- **SOX**: Financial document controls and audit trails
- **GDPR**: Data protection and privacy compliance
- **HIPAA**: Healthcare information security requirements
- **Custom**: Configurable rules for industry-specific requirements

## Direct LWC → Backend Upload POC

This POC replaces the legacy `ContentDocument → Apex → backend` upload pipeline with a direct
`LWC → backend` upload, while keeping the backend as the source of truth for:

- **File hashing**: Canonical SHA-256 hash computed on the backend
- **Storage**: Optional Supabase object storage via `fileStorageService.storeFileAndHash`
- **KRNL workflows**: Same registration and access workflows can consume the backend hash

### Architecture Overview

**Actors:**
- LWC `directUploadToBackend` placed on a Salesforce record page (uses `recordId`)
- Apex `DocumentAccessLogger.initDirectUpload`
- Node backend (`/api/uploads/init` and `/api/uploads/:uploadId/file`)
- Optional Supabase storage

**Flow:**
1. User selects a file in the `directUploadToBackend` LWC and clicks **Upload to Backend**.
2. LWC calls Apex `DocumentAccessLogger.initDirectUpload(recordId)`.
3. Apex calls backend `POST /api/uploads/init` with `{ recordId, userId }` and `X-Salesforce-Token`.
4. Backend validates the Salesforce session, mints a short-lived JWT, and returns a signed
   upload URL (including `?token=...`).
5. LWC performs `fetch(uploadUrl, { method: 'PUT', body: file })` to send the file bytes.
6. Backend verifies the JWT, parses the raw binary body, and calls `storeFileAndHash` to:
   - Compute the canonical SHA-256 hash (`0x`-prefixed)
   - Optionally upload the file to Supabase (bucket + path)
7. Backend returns `{ success, hash, storage }` to the LWC, which displays the hash and
   storage path.

### Backend Endpoints

- `POST /api/uploads/init`
  - Authenticated via `validateSalesforceToken` and the `X-Salesforce-Token` header from Apex.
  - Body: `{ recordId, userId? }`.
  - Creates `uploadId` and signs a JWT with `{ uploadId, recordId, userId }` using `JWT_SECRET`.
  - Responds with `{ uploadId, uploadUrl, uploadPath, expiresInSeconds }` where `uploadUrl`
    uses `PUBLIC_BASE_URL`.
- `PUT /api/uploads/:uploadId/file`
  - Uses a shared `rawFileBody` parser (`express.raw`) so any content type is treated as binary
    for this route.
  - Verifies the `token` query parameter (JWT) and ensures `decoded.uploadId === :uploadId`.
  - Reads the request body as a `Buffer` and forwards it to `storeFileAndHash` together with
    `recordId`, `fileName` (from `X-File-Name`), and `contentType`.
  - Returns `{ success, uploadId, recordId, userId, hash, storage }`.

### Apex Integration

Apex method in `DocumentAccessLogger.cls`:

```apex
@AuraEnabled
public static String initDirectUpload(Id recordId) {
    if (recordId == null) {
        throw new DocumentAccessException('recordId is required for direct upload initialization');
    }

    HttpRequest req = new HttpRequest();
    Http http = new Http();

    String baseEndpoint = 'callout:' + BLOCKCHAIN_ENDPOINT;
    req.setEndpoint(baseEndpoint + '/api/uploads/init');
    req.setMethod('POST');
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Accept', 'application/json');
    req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
    req.setTimeout(120000);

    Map<String, Object> payload = new Map<String, Object>{
        'recordId' => (String)recordId,
        'userId'   => UserInfo.getUserId()
    };
    req.setBody(JSON.serialize(payload));

    HTTPResponse res = http.send(req);
    Integer status = res.getStatusCode();

    if (status >= 200 && status < 300) {
        Map<String, Object> body = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
        if (body != null && body.containsKey('uploadUrl')) {
            return (String)body.get('uploadUrl');
        } else if (body != null && body.containsKey('uploadPath')) {
            return (String)body.get('uploadPath');
        } else {
            throw new DocumentAccessException('Upload initialization response missing uploadUrl');
        }
    }

    throw new DocumentAccessException(
        'Direct upload initialization failed (' + status + '): ' + res.getBody()
    );
}
```

### LWC Component

LWC bundle: `directUploadToBackend`.

- Placed on a `lightning__RecordPage` (e.g. Account) so `recordId` is injected.
- Uses a file input to capture the `File` object from the browser.
- Calls `initDirectUpload({ recordId })` to get the signed upload URL.
- Calls `fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': file.name }, body: file })`.
- On success, displays the returned `hash` and `storage.path` (if Supabase is configured).

### Basic Testing Steps

1. Start the backend with `PUBLIC_BASE_URL` and `JWT_SECRET` configured (and Supabase vars if desired).
2. Ensure Named Credential `krnl_blockchain_endpoint` points to `PUBLIC_BASE_URL`.
3. Deploy `DocumentAccessLogger` and `directUploadToBackend` to the Salesforce org.
4. Add `directUploadToBackend` to a record page via Lightning App Builder.
5. Open a record with the component, select a file, and click **Upload to Backend**.
6. Confirm in the UI that the hash (and storage path, if enabled) are displayed, and in the
   backend logs that `Direct upload completed` is logged with the expected hash and storage info.