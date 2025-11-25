/**
 * @description Service class for logging document access and integrating with blockchain
 * @author Ash
 * @date 2024
 */
public with sharing class DocumentAccessLogger {

    private static final String BLOCKCHAIN_ENDPOINT = 'krnl_blockchain_endpoint';

    /**
     * @description Log document access event
     * @param contentDocumentId Salesforce ContentDocument ID
     * @param accessType Type of access (view, download, modify)
     * @param userId User who accessed the document
     * @return Boolean true if logged successfully
     */
    @AuraEnabled
    public static Boolean logDocumentAccess(Id contentDocumentId, String accessType, Id userId) {
        if (contentDocumentId == null || String.isBlank(accessType) || userId == null) {
            throw new DocumentAccessLogger.DocumentAccessException('Invalid parameters for document access logging');
        }

        try {
            // Generate document hash
            String documentHash = DocumentHashUtil.generateHashForContentDocument(contentDocumentId);

            // Create access log record
            Document_Access_Log__c accessLog = new Document_Access_Log__c(
                Document_ID__c = contentDocumentId,
                Document_Hash__c = documentHash,
                Access_Type__c = accessType,
                User_ID__c = userId,
                Access_Timestamp__c = Datetime.now(),
                IP_Address__c = getClientIP(),
                User_Agent__c = getUserAgent(),
                Status__c = 'Pending'
            );

            insert accessLog;

            // Queue blockchain logging (asynchronous)
            if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
                System.enqueueJob(new BlockchainLogger(accessLog.Id, documentHash, accessType, userId));
            } else {
                // Fallback: Mark for batch processing
                accessLog.Status__c = 'Queued for Blockchain';
                update accessLog;
            }

            return true;

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to log document access: ' + e.getMessage());
            throw new DocumentAccessLogger.DocumentAccessException('Failed to log document access: ' + e.getMessage());
        }
    }

    /**
     * @description Log access for a direct-uploaded document backed by Blockchain_Document__c
     * @param blockchainDocId Blockchain_Document__c ID
     * @param accessType Type of access (view, download, modify)
     * @return Boolean true if logged successfully
     */
    @AuraEnabled
    public static Boolean logDirectUploadAccess(Id blockchainDocId, String accessType) {
        if (blockchainDocId == null || String.isBlank(accessType)) {
            throw new DocumentAccessLogger.DocumentAccessException('Invalid parameters for direct upload access logging');
        }

        try {
            Blockchain_Document__c blockchainDoc = [
                SELECT Id, Document_ID__c, Document_Hash__c
                FROM Blockchain_Document__c
                WHERE Id = :blockchainDocId
                LIMIT 1
            ];

            Id userId = UserInfo.getUserId();

            Document_Access_Log__c accessLog = new Document_Access_Log__c(
                Document_ID__c = blockchainDoc.Document_ID__c,
                Document_Hash__c = blockchainDoc.Document_Hash__c,
                Access_Type__c = accessType,
                User_ID__c = userId,
                Access_Timestamp__c = Datetime.now(),
                IP_Address__c = getClientIP(),
                User_Agent__c = getUserAgent(),
                Status__c = 'Pending'
            );

            insert accessLog;

            if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
                System.enqueueJob(new BlockchainLogger(accessLog.Id, blockchainDoc.Document_Hash__c, accessType, userId));
            } else {
                accessLog.Status__c = 'Queued for Blockchain';
                update accessLog;
            }

            return true;

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to log direct upload access: ' + e.getMessage());
            throw new DocumentAccessLogger.DocumentAccessException('Failed to log direct upload access: ' + e.getMessage());
        }
    }

    /**
     * @description Get a watermarked viewer URL for a direct-upload document.
     * This method synchronously logs document access via KRNL, waits for on-chain
     * confirmation, and returns a watermarked viewer URL incorporating the access hash.
     * @param blockchainDocId Blockchain_Document__c ID
     * @param path Supabase storage path for the file (e.g. <recordId>/<fileName>)
     * @param accessType Type of access (view, download, modify)
     * @return String watermarked viewer URL that can be opened in the browser
     */
    @AuraEnabled
    public static String getWatermarkedViewerUrlForDirectUpload(Id blockchainDocId, String path, String accessType) {
        if (blockchainDocId == null || String.isBlank(path) || String.isBlank(accessType)) {
            throw new DocumentAccessException('blockchainDocId, path, and accessType are required');
        }

        try {
            // Query Blockchain_Document__c to get document hash and record ID
            Blockchain_Document__c blockchainDoc = [
                SELECT Id, Document_ID__c, Document_Hash__c
                FROM Blockchain_Document__c
                WHERE Id = :blockchainDocId
                LIMIT 1
            ];

            Id userId = UserInfo.getUserId();
            String clientIP = getClientIP();
            String userAgent = getUserAgent();

            // Call KRNL backend /api/access to log access and wait for on-chain confirmation
            HttpRequest req = new HttpRequest();
            Http http = new Http();

            String baseEndpoint = 'callout:' + BLOCKCHAIN_ENDPOINT;
            req.setEndpoint(baseEndpoint + '/api/access');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Accept', 'application/json');
            req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
            req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
            req.setTimeout(120000); // 2 minutes to allow for KRNL workflow + on-chain confirmation

            Map<String, Object> payload = new Map<String, Object>{
                'documentHash' => blockchainDoc.Document_Hash__c,
                'recordId' => (String)blockchainDoc.Document_ID__c,
                'userId' => (String)userId,
                'accessType' => accessType,
                'clientIP' => clientIP,
                'userAgent' => userAgent,
                'documentId' => path
            };
            req.setBody(JSON.serialize(payload));

            HTTPResponse res = http.send(req);
            Integer status = res.getStatusCode();

            if (status >= 200 && status < 300) {
                Map<String, Object> body = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
                
                // Extract viewerUrl and accessHash from response
                String viewerUrl = body.containsKey('viewerUrl') ? (String)body.get('viewerUrl') : null;
                String accessHash = body.containsKey('accessHash') ? (String)body.get('accessHash') : null;
                String txHash = body.containsKey('txHash') ? (String)body.get('txHash') : null;

                // Optionally create/update Document_Access_Log__c with status and accessHash
                Document_Access_Log__c accessLog = new Document_Access_Log__c(
                    Document_ID__c = blockchainDoc.Document_ID__c,
                    Document_Hash__c = blockchainDoc.Document_Hash__c,
                    Access_Type__c = accessType,
                    User_ID__c = userId,
                    Access_Timestamp__c = Datetime.now(),
                    IP_Address__c = clientIP,
                    User_Agent__c = userAgent,
                    Status__c = 'Logged to Blockchain',
                    Blockchain_Response__c = res.getBody()
                );
                insert accessLog;

                if (String.isBlank(viewerUrl)) {
                    throw new DocumentAccessException('Backend did not return a viewerUrl');
                }

                return viewerUrl;
            } else {
                throw new DocumentAccessException(
                    'Access logging failed (' + status + '): ' + res.getBody()
                );
            }

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to get watermarked viewer URL: ' + e.getMessage());
            throw new DocumentAccessException('Failed to get watermarked viewer URL: ' + e.getMessage());
        }
    }

    /**
     * @description Get a short-lived viewer URL for a Supabase-backed file from the KRNL backend
     * @param recordId Salesforce record ID associated with the file (for logging and context)
     * @param path Supabase storage path for the file (e.g. <recordId>/<fileName>)
     * @return String viewer URL that can be opened in the browser
     */
    @AuraEnabled
    public static String getViewerUrl(Id recordId, String path) {
        if (String.isBlank(path)) {
            throw new DocumentAccessException('path is required to request a viewer URL');
        }

        HttpRequest req = new HttpRequest();
        Http http = new Http();

        String baseEndpoint = 'callout:' + BLOCKCHAIN_ENDPOINT;
        req.setEndpoint(baseEndpoint + '/api/files/viewer-url');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        // Provide Salesforce token for backend middleware if required
        req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
        req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
        req.setTimeout(120000);

        Map<String, Object> payload = new Map<String, Object>{
            'path' => path,
            'recordId' => recordId != null ? (String)recordId : null
        };
        req.setBody(JSON.serialize(payload));

        HTTPResponse res = http.send(req);
        Integer status = res.getStatusCode();

        if (status >= 200 && status < 300) {
            Map<String, Object> body = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
            if (body != null && body.containsKey('url')) {
                return (String)body.get('url');
            } else {
                throw new DocumentAccessException('Viewer URL response missing url');
            }
        }

        throw new DocumentAccessException(
            'Viewer URL request failed (' + status + '): ' + res.getBody()
        );
    }

    /**
     * @description Register already-uploaded document on blockchain
     * @param blockchainDocId Blockchain_Document__c ID
     * @return Boolean true if registered successfully
     */
    @AuraEnabled
    public static Boolean registerDocumentOnBlockchain(Id blockchainDocId) {
        try {
            // Query the Blockchain_Document__c record to get hash and metadata
            Blockchain_Document__c blockchainDoc = [
                SELECT Id, Document_Hash__c, Document_ID__c, Metadata__c
                FROM Blockchain_Document__c
                WHERE Id = :blockchainDocId
                LIMIT 1
            ];

            // Parse metadata
            Map<String, Object> metadata = new Map<String, Object>();
            if (String.isNotBlank(blockchainDoc.Metadata__c)) {
                metadata = (Map<String, Object>) JSON.deserializeUntyped(blockchainDoc.Metadata__c);
            }

            // Ensure we have recordId in metadata
            if (!metadata.containsKey('recordId') && String.isNotBlank(blockchainDoc.Document_ID__c)) {
                metadata.put('recordId', blockchainDoc.Document_ID__c);
            }

            // Update status to Pending
            blockchainDoc.Blockchain_Status__c = 'Pending';
            update blockchainDoc;

            // Queue blockchain registration with existing hash
            if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
                System.enqueueJob(new DirectUploadRegistrar(
                    blockchainDoc.Id, 
                    blockchainDoc.Document_Hash__c, 
                    blockchainDoc.Document_ID__c,
                    metadata
                ));
            }

            return true;

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to register document on blockchain: ' + e.getMessage());
            return false;
        }
    }

    /**
     * @description Bulk register documents on blockchain
     * @param contentDocumentIds List of ContentDocument IDs
     */
    public static void bulkRegisterDocuments(List<Id> contentDocumentIds) {
        if (contentDocumentIds == null || contentDocumentIds.isEmpty()) {
            return;
        }

        try {
            Map<Id, String> hashResults = DocumentHashUtil.batchGenerateHashes(contentDocumentIds);
            List<Blockchain_Document__c> blockchainDocs = new List<Blockchain_Document__c>();

            for (Id docId : hashResults.keySet()) {
                try {
                    Map<String, Object> metadata = DocumentHashUtil.createDocumentMetadata(docId);

                    blockchainDocs.add(new Blockchain_Document__c(
                        Document_ID__c = docId,
                        Document_Hash__c = hashResults.get(docId),
                        Blockchain_Status__c = 'Pending',
                        Registration_Timestamp__c = Datetime.now(),
                        Metadata__c = JSON.serialize(metadata)
                    ));
                } catch (Exception e) {
                    System.debug(LoggingLevel.ERROR, 'Failed to prepare blockchain doc for ' + docId + ': ' + e.getMessage());
                }
            }

            if (!blockchainDocs.isEmpty()) {
                insert blockchainDocs;

                // Queue bulk blockchain registration
                if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
                    System.enqueueJob(new BulkBlockchainRegistrar(blockchainDocs));
                }
            }

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Bulk document registration failed: ' + e.getMessage());
        }
    }

    /**
     * @description Validate document integrity against blockchain
     * @param contentDocumentId Salesforce ContentDocument ID
     * @return Boolean true if document integrity is valid
     */
    @AuraEnabled
    public static Boolean validateDocumentIntegrity(Id contentDocumentId) {
        try {
            // Get stored blockchain hash
            Blockchain_Document__c blockchainDoc = [
                SELECT Document_Hash__c, Blockchain_Status__c
                FROM Blockchain_Document__c
                WHERE Document_ID__c = :contentDocumentId
                AND Blockchain_Status__c = 'Registered'
                LIMIT 1
            ];

            // Generate current hash and compare
            return DocumentHashUtil.validateDocumentIntegrity(contentDocumentId, blockchainDoc.Document_Hash__c);

        } catch (QueryException e) {
            System.debug(LoggingLevel.WARN, 'Document not found in blockchain registry: ' + contentDocumentId);
            return false;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Document integrity validation failed: ' + e.getMessage());
            return false;
        }
    }

    /**
     * @description Initialize a direct upload session to the KRNL backend for LWC
     * @param recordId Salesforce record ID that this document is associated with
     * @return String upload URL that the LWC can call with a raw file PUT
     */
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
        // Provide Salesforce token for backend middleware if required
        req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
        req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
        req.setTimeout(120000);

        Map<String, Object> payload = new Map<String, Object>{
            'recordId' => (String)recordId,
            'userId' => UserInfo.getUserId()
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

    /**
     * @description Record metadata about a direct upload so we can list uploads per record
     * @param recordId Salesforce record ID associated with the upload
     * @param hash Canonical SHA-256 hash (0x-prefixed) returned by the backend
     * @param storageBucket Supabase bucket name (optional)
     * @param storagePath Supabase path within the bucket (optional)
     * @param fileName Original file name as seen by the user (optional)
     * @return Id of the created Blockchain_Document__c record
     */
    @AuraEnabled
    public static Id recordDirectUploadMetadata(
        Id recordId,
        String hash,
        String storageBucket,
        String storagePath,
        String fileName
    ) {
        if (recordId == null) {
            throw new DocumentAccessException('recordId is required to record upload metadata');
        }
        if (String.isBlank(hash)) {
            throw new DocumentAccessException('hash is required to record upload metadata');
        }

        Map<String, Object> metadata = new Map<String, Object>();
        if (!String.isBlank(fileName)) {
            metadata.put('fileName', fileName);
        }
        if (!String.isBlank(storageBucket)) {
            metadata.put('bucket', storageBucket);
        }
        if (!String.isBlank(storagePath)) {
            metadata.put('path', storagePath);
        }

        Blockchain_Document__c doc = new Blockchain_Document__c(
            Document_ID__c = recordId,
            Document_Hash__c = hash,
            Blockchain_Status__c = 'Pending',
            Registration_Timestamp__c = Datetime.now(),
            Metadata__c = metadata.isEmpty() ? null : JSON.serialize(metadata)
        );

        insert doc;

        // Automatically queue blockchain registration after upload
        if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
            System.enqueueJob(new DirectUploadRegistrar(
                doc.Id,
                hash,
                recordId,
                metadata
            ));
        }

        return doc.Id;
    }

    /**
     * @description Get client IP address from request headers
     * @return String client IP address
     */
    private static String getClientIP() {
        // In Salesforce, getting real client IP requires custom header parsing
        // This is a simplified implementation
        return 'Salesforce_Internal';
    }

    /**
     * @description Get user agent from request headers
     * @return String user agent
     */
    private static String getUserAgent() {
        // In Salesforce, getting user agent requires custom implementation
        // This is a simplified implementation
        return 'Salesforce_Browser';
    }

    /**
     * @description Custom exception for document access logging errors
     */
    public class DocumentAccessException extends Exception {}

    /**
     * @description Queueable class for blockchain logging
     */
    public class BlockchainLogger implements Queueable, Database.AllowsCallouts {
        private Id accessLogId;
        private String documentHash;
        private String accessType;
        private Id userId;

        public BlockchainLogger(Id accessLogId, String documentHash, String accessType, Id userId) {
            this.accessLogId = accessLogId;
            this.documentHash = documentHash;
            this.accessType = accessType;
            this.userId = userId;
        }

        public void execute(QueueableContext context) {
            try {
                // Load access log to enrich payload for KRNL backend
                Document_Access_Log__c accessLogRecord = [
                    SELECT Document_ID__c, IP_Address__c, User_Agent__c
                    FROM Document_Access_Log__c
                    WHERE Id = :accessLogId
                    LIMIT 1
                ];

                // Call KRNL backend /api/access via callout
                // Note: documentId should ideally be the file path; here we use recordId as a fallback
                Map<String, Object> payload = new Map<String, Object>{
                    'documentHash' => documentHash,
                    'recordId' => (String)accessLogRecord.Document_ID__c,
                    'userId' => (String)userId,
                    'accessType' => accessType,
                    'clientIP' => accessLogRecord.IP_Address__c,
                    'userAgent' => accessLogRecord.User_Agent__c,
                    'documentId' => (String)accessLogRecord.Document_ID__c
                };

                String result = callBlockchainAPI('logAccess', payload);

                // Update access log status
                Document_Access_Log__c accessLog = new Document_Access_Log__c(
                    Id = accessLogId,
                    Status__c = 'Logged to Blockchain',
                    Blockchain_Response__c = result
                );
                update accessLog;

            } catch (Exception e) {
                // Update with error status
                Document_Access_Log__c accessLog = new Document_Access_Log__c(
                    Id = accessLogId,
                    Status__c = 'Blockchain Error',
                    Error_Message__c = e.getMessage()
                );
                update accessLog;
            }
        }
    }

    /**
     * @description Queueable class for blockchain document registration
     */
    public class BlockchainRegistrar implements Queueable, Database.AllowsCallouts {
        private Id blockchainDocId;
        private String documentHash; // Initial local hash, will be replaced by backend hash
        private Map<String, Object> metadata;

        public BlockchainRegistrar(Id blockchainDocId, String documentHash, Map<String, Object> metadata) {
            this.blockchainDocId = blockchainDocId;
            this.documentHash = documentHash;
            this.metadata = metadata;
        }

        public void execute(QueueableContext context) {
            try {
                String salesforceRecordId = (String)metadata.get('salesforceId');

                // 1. Upload file to backend to get authoritative hash and storage
                Map<String, Object> uploadResult = uploadFileToBackend(salesforceRecordId);
                String backendHash = (String)uploadResult.get('hash');
                // Optional: store storage path if needed
                // Map<String, Object> storage = (Map<String, Object>)uploadResult.get('storage');

                // 2. Prepare payload for KRNL backend /api/compliance using BACKEND HASH
                Map<String, Object> payload = new Map<String, Object>{
                    'recordId' => salesforceRecordId,
                    'fileId' => salesforceRecordId,
                    'docHash' => backendHash // Use authoritative hash
                };

                String result = callBlockchainAPI('registerDocument', payload);

                // 3. Update blockchain document status and hash
                Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                    Id = blockchainDocId,
                    Document_Hash__c = backendHash, // Update with authoritative hash
                    Blockchain_Status__c = 'Registered',
                    Blockchain_Response__c = result
                );
                update blockchainDoc;

            } catch (Exception e) {
                // Update with error status
                Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                    Id = blockchainDocId,
                    Blockchain_Status__c = 'Registration Failed',
                    Error_Message__c = e.getMessage()
                );
                update blockchainDoc;
            }
        }

        /**
         * @description Upload file content to backend for hashing and storage
         */
        private Map<String, Object> uploadFileToBackend(String contentDocumentId) {
            // Query ContentVersion to get the file content
            ContentVersion cv = [
                SELECT VersionData, Title, FileExtension
                FROM ContentVersion
                WHERE ContentDocumentId = :contentDocumentId
                AND IsLatest = true
                LIMIT 1
            ];

            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + BLOCKCHAIN_ENDPOINT + '/api/files/upload');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/octet-stream');
            req.setHeader('X-Content-Document-Id', contentDocumentId);
            req.setHeader('X-File-Name', cv.Title + '.' + cv.FileExtension);
            req.setBodyAsBlob(cv.VersionData);
            req.setTimeout(120000); // 2 minutes for upload

            Http http = new Http();
            HTTPResponse res = http.send(req);

            if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
                return (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
            } else {
                throw new DocumentAccessException(
                    'File upload failed (' + res.getStatusCode() + '): ' + res.getBody()
                );
            }
        }
    }

    /**
     * @description Queueable class for registering already-uploaded documents on blockchain
     */
    public class DirectUploadRegistrar implements Queueable, Database.AllowsCallouts {
        private Id blockchainDocId;
        private String documentHash;
        private String recordId;
        private Map<String, Object> metadata;

        public DirectUploadRegistrar(Id blockchainDocId, String documentHash, String recordId, Map<String, Object> metadata) {
            this.blockchainDocId = blockchainDocId;
            this.documentHash = documentHash;
            this.recordId = recordId;
            this.metadata = metadata;
        }

        public void execute(QueueableContext context) {
            try {
                // File is already uploaded to Supabase, hash is already computed
                // Call direct registration endpoint (bypasses KRNL workflow)
                HttpRequest req = new HttpRequest();
                req.setEndpoint('callout:' + BLOCKCHAIN_ENDPOINT + '/api/documents/register-direct');
                req.setMethod('POST');
                req.setHeader('Content-Type', 'application/json');
                req.setHeader('Accept', 'application/json');
                req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
                req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
                req.setTimeout(120000);

                Map<String, Object> payload = new Map<String, Object>{
                    'documentHash' => documentHash,
                    'salesforceRecordId' => recordId,
                    'metadata' => JSON.serialize(metadata)
                };

                req.setBody(JSON.serialize(payload));

                Http http = new Http();
                HTTPResponse res = http.send(req);

                if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
                    Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                    
                    // Update blockchain document status
                    Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                        Id = blockchainDocId,
                        Blockchain_Status__c = 'Registered',
                        Blockchain_Response__c = JSON.serialize(result),
                        Registration_Timestamp__c = Datetime.now()
                    );
                    update blockchainDoc;
                } else {
                    throw new DocumentAccessException(
                        'Direct registration failed (' + res.getStatusCode() + '): ' + res.getBody()
                    );
                }

            } catch (Exception e) {
                // Update with error status
                Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                    Id = blockchainDocId,
                    Blockchain_Status__c = 'Registration Failed',
                    Error_Message__c = e.getMessage()
                );
                update blockchainDoc;
            }
        }
    }

    /**
     * @description Queueable class for bulk blockchain registration
     */
    public class BulkBlockchainRegistrar implements Queueable, Database.AllowsCallouts {
        private List<Blockchain_Document__c> blockchainDocs;

        public BulkBlockchainRegistrar(List<Blockchain_Document__c> blockchainDocs) {
            this.blockchainDocs = blockchainDocs;
        }

        public void execute(QueueableContext context) {
            List<Blockchain_Document__c> docsToUpdate = new List<Blockchain_Document__c>();

            for (Blockchain_Document__c doc : blockchainDocs) {
                try {
                    // Call KRNL backend /api/compliance for each document
                    Map<String, Object> payload = new Map<String, Object>{
                        'recordId' => (String)doc.Document_ID__c,
                        'fileId' => (String)doc.Document_ID__c,
                        'docHash' => doc.Document_Hash__c
                    };

                    String result = callBlockchainAPI('registerDocument', payload);

                    doc.Blockchain_Status__c = 'Registered';
                    doc.Blockchain_Response__c = result;

                } catch (Exception e) {
                    doc.Blockchain_Status__c = 'Registration Failed';
                    doc.Error_Message__c = e.getMessage();
                }

                docsToUpdate.add(doc);
            }

            if (!docsToUpdate.isEmpty()) {
                update docsToUpdate;
            }
        }
    }

    /**
     * @description Make HTTP callout to blockchain API
     * @param operation The blockchain operation to perform
     * @param parameters Operation parameters
     * @return String API response
     */
    private static String callBlockchainAPI(String operation, Map<String, Object> parameters) {
        HttpRequest req = new HttpRequest();
        Http http = new Http();

        // Determine target endpoint based on operation
        String baseEndpoint = 'callout:' + BLOCKCHAIN_ENDPOINT;
        if (operation == 'logAccess') {
            req.setEndpoint(baseEndpoint + '/api/access');
        } else if (operation == 'registerDocument') {
            req.setEndpoint(baseEndpoint + '/api/compliance');
        } else {
            throw new DocumentAccessException('Unsupported blockchain operation: ' + operation);
        }

        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        // Provide Salesforce token for backend middleware if required
        req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
        req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
        req.setTimeout(120000);
        req.setBody(JSON.serialize(parameters));

        HTTPResponse res = http.send(req);
        Integer status = res.getStatusCode();

        if (status >= 200 && status < 300) {
            return res.getBody();
        }

        throw new DocumentAccessException(
            'KRNL backend call failed (' + status + '): ' + res.getBody()
        );
    }
}