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
     * @description Register document on blockchain
     * @param contentDocumentId Salesforce ContentDocument ID
     * @return Boolean true if registered successfully
     */
    @AuraEnabled
    public static Boolean registerDocumentOnBlockchain(Id contentDocumentId) {
        try {
            String documentHash = DocumentHashUtil.generateHashForContentDocument(contentDocumentId);
            Map<String, Object> metadata = DocumentHashUtil.createDocumentMetadata(contentDocumentId);

            // Create blockchain registration record
            Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                Document_ID__c = contentDocumentId,
                Document_Hash__c = documentHash,
                Blockchain_Status__c = 'Pending',
                Registration_Timestamp__c = Datetime.now(),
                Metadata__c = JSON.serialize(metadata)
            );

            insert blockchainDoc;

            // Queue blockchain registration
            if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
                System.enqueueJob(new BlockchainRegistrar(blockchainDoc.Id, documentHash, metadata));
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
                // Call blockchain API to log access
                String result = callBlockchainAPI('logAccess', new Map<String, Object>{
                    'documentHash' => documentHash,
                    'accessType' => accessType,
                    'userId' => userId,
                    'timestamp' => Datetime.now().format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
                });

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
        private String documentHash;
        private Map<String, Object> metadata;

        public BlockchainRegistrar(Id blockchainDocId, String documentHash, Map<String, Object> metadata) {
            this.blockchainDocId = blockchainDocId;
            this.documentHash = documentHash;
            this.metadata = metadata;
        }

        public void execute(QueueableContext context) {
            try {
                // Call blockchain API to register document
                String result = callBlockchainAPI('registerDocument', new Map<String, Object>{
                    'documentHash' => documentHash,
                    'salesforceRecordId' => (String)metadata.get('salesforceId'),
                    'metadata' => JSON.serialize(metadata)
                });

                // Update blockchain document status
                Blockchain_Document__c blockchainDoc = new Blockchain_Document__c(
                    Id = blockchainDocId,
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
                    // Call blockchain API for each document
                    String result = callBlockchainAPI('registerDocument', new Map<String, Object>{
                        'documentHash' => doc.Document_Hash__c,
                        'salesforceRecordId' => doc.Document_ID__c,
                        'metadata' => doc.Metadata__c
                    });

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
        // This would integrate with your actual blockchain API endpoint
        // For now, return a mock response
        return JSON.serialize(new Map<String, Object>{
            'success' => true,
            'operation' => operation,
            'timestamp' => Datetime.now().format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'transactionHash' => '0x' + EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(JSON.serialize(parameters))))
        });
    }
}