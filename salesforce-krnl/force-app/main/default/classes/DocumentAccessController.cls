/**
 * @description Controller class for DocumentAccessTracker LWC component
 * @author Ash
 * @date 2024
 */
public with sharing class DocumentAccessController {

    /**
     * @description Get list of available documents from Blockchain_Document__c
     * @return List<DocumentWrapper> List of documents with metadata
     */
    @AuraEnabled(cacheable=true)
    public static List<DocumentWrapper> getDocuments() {
        List<DocumentWrapper> documentWrappers = new List<DocumentWrapper>();

        try {
            List<Blockchain_Document__c> documents = [
                SELECT Id, Name, Document_Hash__c, Document_ID__c, Metadata__c, File_Name__c,
                       Registration_Timestamp__c, Blockchain_Status__c, CreatedDate, OwnerId
                FROM Blockchain_Document__c
                ORDER BY CreatedDate DESC
                LIMIT 100
            ];

            for (Blockchain_Document__c doc : documents) {
                DocumentWrapper wrapper = new DocumentWrapper();
                wrapper.id = doc.Id;
                
                // Prefer explicit File_Name__c; fall back to Metadata__c JSON
                String fileName = 'Unknown Document';
                if (String.isNotBlank(doc.File_Name__c)) {
                    fileName = doc.File_Name__c;
                } else if (String.isNotBlank(doc.Metadata__c)) {
                    try {
                        Map<String, Object> metadata = (Map<String, Object>) JSON.deserializeUntyped(doc.Metadata__c);
                        if (metadata.containsKey('fileName')) {
                            fileName = (String) metadata.get('fileName');
                        }
                    } catch (Exception e) {
                        // Keep default fileName if parsing fails
                    }
                }
                
                wrapper.title = fileName;
                wrapper.fileType = doc.Blockchain_Status__c; // Use status as file type
                wrapper.contentSize = 0; // Not tracking size in current schema
                wrapper.createdDate = doc.CreatedDate;
                wrapper.lastModifiedDate = doc.Registration_Timestamp__c;
                wrapper.ownerId = doc.OwnerId;
                wrapper.documentHash = doc.Document_Hash__c; // Add hash for reference
                wrapper.metadata = doc.Metadata__c;

                documentWrappers.add(wrapper);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve documents: ' + e.getMessage());
        }

        return documentWrappers;
    }

    /**
     * @description Get access logs for a specific document
     * @param documentId ContentDocument ID (passed as String from LWC)
     * @return List<AccessLogWrapper> List of access log entries
     */
    @AuraEnabled
    public static List<AccessLogWrapper> getDocumentAccessLogs(String documentId) {
        List<AccessLogWrapper> logWrappers = new List<AccessLogWrapper>();

        if (String.isBlank(documentId)) {
            return logWrappers;
        }

        try {
            List<Document_Access_Log__c> logs = [
                SELECT Id, Name, Document_ID__c, Document_Hash__c, Access_Type__c,
                       User_ID__c, Access_Timestamp__c, IP_Address__c, User_Agent__c,
                       Status__c, Session_Id__c, Blockchain_Response__c, Error_Message__c,
                       CreatedBy.Name
                FROM Document_Access_Log__c
                WHERE Document_ID__c = :documentId
                ORDER BY Access_Timestamp__c DESC
                LIMIT 50
            ];

            // Collect document hashes to resolve file metadata
            Set<String> documentHashes = new Set<String>();
            for (Document_Access_Log__c log : logs) {
                if (String.isNotBlank(log.Document_Hash__c)) {
                    documentHashes.add(log.Document_Hash__c);
                }
            }

            // Query related Blockchain_Document__c records, keyed by hash so we can resolve fileName
            Map<String, Blockchain_Document__c> documentMap = new Map<String, Blockchain_Document__c>();
            if (!documentHashes.isEmpty()) {
                for (Blockchain_Document__c doc : [
                    SELECT Id, Document_ID__c, Document_Hash__c, Metadata__c, File_Name__c
                    FROM Blockchain_Document__c
                    WHERE Document_Hash__c IN :documentHashes
                ]) {
                    if (String.isNotBlank(doc.Document_Hash__c)) {
                        documentMap.put(doc.Document_Hash__c, doc);
                    }
                }
            }

            for (Document_Access_Log__c log : logs) {
                AccessLogWrapper wrapper = new AccessLogWrapper();
                wrapper.id = log.Id;
                wrapper.documentId = log.Document_ID__c;
                wrapper.documentHash = log.Document_Hash__c;
                wrapper.accessType = log.Access_Type__c;
                wrapper.userId = log.User_ID__c;
                wrapper.accessTimestamp = log.Access_Timestamp__c;
                wrapper.ipAddress = log.IP_Address__c;
                wrapper.userAgent = log.User_Agent__c;
                wrapper.status = log.Status__c;
                wrapper.sessionId = log.Session_Id__c;
                wrapper.errorMessage = log.Error_Message__c;
                wrapper.userName = log.CreatedBy.Name;
                wrapper.blockchainStatus = getBlockchainStatusForLog(log);

                // Resolve fileName from related Blockchain_Document__c
                Blockchain_Document__c doc = documentMap.get(log.Document_Hash__c);
                if (doc != null) {
                    if (String.isNotBlank(doc.File_Name__c)) {
                        wrapper.fileName = doc.File_Name__c;
                    } else if (String.isNotBlank(doc.Metadata__c)) {
                        try {
                            Map<String, Object> metadata = (Map<String, Object>)JSON.deserializeUntyped(doc.Metadata__c);
                            if (metadata.containsKey('fileName')) {
                                wrapper.fileName = (String)metadata.get('fileName');
                            }
                        } catch (Exception e) {
                            // Ignore parsing errors
                        }
                    }
                }

                logWrappers.add(wrapper);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve access logs: ' + e.getMessage());
        }

        return logWrappers;
    }

    /**
     * @description Fetch full session details from backend for a given sessionId
     * @param sessionId The KRNL session ID
     * @return Map<String, Object> Session details including accessHash, txHash, status, etc.
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Object> getSessionDetails(String sessionId) {
        if (String.isBlank(sessionId)) {
            throw new AuraHandledException('Session ID is required');
        }

        try {
            HttpRequest req = new HttpRequest();
            Http http = new Http();

            String baseEndpoint = 'callout:krnl_blockchain_endpoint';
            String encodedSessionId = EncodingUtil.urlEncode(sessionId, 'UTF-8');
            req.setEndpoint(baseEndpoint + '/api/access/session/' + encodedSessionId);
            req.setMethod('GET');
            req.setHeader('Accept', 'application/json');
            req.setHeader('X-Salesforce-Token', UserInfo.getSessionId());
            req.setHeader('X-Salesforce-Instance-Url', URL.getOrgDomainUrl().toExternalForm());
            req.setTimeout(120000);

            HTTPResponse res = http.send(req);
            Integer status = res.getStatusCode();

            if (status < 200 || status >= 300) {
                throw new AuraHandledException('Failed to fetch session details: ' + res.getBody());
            }

            Map<String, Object> body = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
            
            if (body == null || !body.containsKey('success') || !(Boolean)body.get('success')) {
                throw new AuraHandledException('Invalid response from backend');
            }

            return body;
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching session details: ' + e.getMessage());
        }
    }

    /**
     * @description Get uploaded documents for a specific Salesforce record (direct uploads)
     * @param recordId Salesforce record ID (parent record associated with uploads)
     * @return List<DocumentUploadWrapper> List of uploaded documents and their metadata
     */
    @AuraEnabled(cacheable=true)
    public static List<DocumentUploadWrapper> getUploadsForRecord(Id recordId) {
        List<DocumentUploadWrapper> uploads = new List<DocumentUploadWrapper>();

        if (recordId == null) {
            return uploads;
        }

        try {
            List<Blockchain_Document__c> docs = [
                SELECT Id, Document_ID__c, Document_Hash__c,
                       Blockchain_Status__c, Registration_Timestamp__c,
                       Metadata__c, File_Name__c
                FROM Blockchain_Document__c
                WHERE Document_ID__c = :recordId
                ORDER BY Registration_Timestamp__c DESC
                LIMIT 50
            ];

            for (Blockchain_Document__c doc : docs) {
                DocumentUploadWrapper w = new DocumentUploadWrapper();
                w.id = doc.Id;
                w.documentId = doc.Document_ID__c;
                w.documentHash = doc.Document_Hash__c;
                w.blockchainStatus = doc.Blockchain_Status__c;
                w.registrationTimestamp = doc.Registration_Timestamp__c;
                w.metadata = doc.Metadata__c;
                w.fileName = doc.File_Name__c;

                if (String.isNotBlank(doc.Metadata__c)) {
                    try {
                        Map<String, Object> meta = (Map<String, Object>)JSON.deserializeUntyped(doc.Metadata__c);
                        if (String.isBlank(w.fileName) && meta.containsKey('fileName')) {
                            w.fileName = (String)meta.get('fileName');
                        }
                        if (meta.containsKey('bucket')) {
                            w.bucket = (String)meta.get('bucket');
                        }
                        if (meta.containsKey('path')) {
                            w.path = (String)meta.get('path');
                        }
                    } catch (Exception e) {
                        // Ignore metadata parsing errors for safety; core fields are still available
                    }
                }
                
                // Ensure path always has a value for file retrieval
                // If metadata doesn't have path OR path is missing filename, construct it from documentId + fileName
                if (String.isBlank(w.path) || !w.path.contains('/')) {
                    String fallbackFileName = String.isNotBlank(w.fileName) ? w.fileName : 'document.pdf';
                    w.path = doc.Document_ID__c + '/' + fallbackFileName;
                }

                uploads.add(w);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve uploads for record: ' + e.getMessage());
        }

        return uploads;
    }

    /**
     * @description Get compliance statistics and dashboard data
     * @return ComplianceStatsWrapper Compliance statistics
     */
    @AuraEnabled(cacheable=true)
    public static ComplianceStatsWrapper getComplianceStats() {
        ComplianceStatsWrapper stats = new ComplianceStatsWrapper();

        try {
            // Total documents count (from Blockchain_Document__c where we store upload metadata)
            stats.totalDocuments = [SELECT COUNT() FROM Blockchain_Document__c];

            // Blockchain registered documents count
            stats.blockchainRegistered = [
                SELECT COUNT()
                FROM Blockchain_Document__c
                WHERE Blockchain_Status__c = 'Registered'
            ];

            // Total access events count
            stats.totalAccessEvents = [SELECT COUNT() FROM Document_Access_Log__c];

            // Recent activity (last 30 days)
            Date thirtyDaysAgo = Date.today().addDays(-30);
            stats.recentAccessEvents = [
                SELECT COUNT()
                FROM Document_Access_Log__c
                WHERE CreatedDate >= :thirtyDaysAgo
            ];

            // Documents by status
            AggregateResult[] blockchainStatusCounts = [
                SELECT Blockchain_Status__c, COUNT(Id) total
                FROM Blockchain_Document__c
                GROUP BY Blockchain_Status__c
            ];

            Map<String, Integer> statusBreakdown = new Map<String, Integer>();
            for (AggregateResult ar : blockchainStatusCounts) {
                statusBreakdown.put((String)ar.get('Blockchain_Status__c'), (Integer)ar.get('total'));
            }
            stats.blockchainStatusBreakdown = statusBreakdown;

            // Access types breakdown
            AggregateResult[] accessTypeCounts = [
                SELECT Access_Type__c, COUNT(Id) total
                FROM Document_Access_Log__c
                WHERE CreatedDate >= :thirtyDaysAgo
                GROUP BY Access_Type__c
            ];

            Map<String, Integer> accessTypeBreakdown = new Map<String, Integer>();
            for (AggregateResult ar : accessTypeCounts) {
                accessTypeBreakdown.put((String)ar.get('Access_Type__c'), (Integer)ar.get('total'));
            }
            stats.accessTypeBreakdown = accessTypeBreakdown;

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve compliance statistics: ' + e.getMessage());
        }

        return stats;
    }

    /**
     * @description Get blockchain document status for a specific document
     * @param documentId ContentDocument ID (passed as String from LWC)
     * @return BlockchainDocumentWrapper Blockchain document information
     */
    @AuraEnabled(cacheable=true)
    public static BlockchainDocumentWrapper getBlockchainDocumentStatus(String documentId) {
        BlockchainDocumentWrapper wrapper = new BlockchainDocumentWrapper();

        if (String.isBlank(documentId)) {
            return wrapper;
        }

        try {
            List<Blockchain_Document__c> blockchainDocs = [
                SELECT Id, Name, Document_ID__c, Document_Hash__c,
                       Blockchain_Status__c, Registration_Timestamp__c,
                       Blockchain_Response__c, Error_Message__c, Metadata__c
                FROM Blockchain_Document__c
                WHERE Document_ID__c = :documentId
                ORDER BY Registration_Timestamp__c DESC
                LIMIT 1
            ];

            if (!blockchainDocs.isEmpty()) {
                Blockchain_Document__c doc = blockchainDocs[0];
                wrapper.id = doc.Id;
                wrapper.documentId = doc.Document_ID__c;
                wrapper.documentHash = doc.Document_Hash__c;
                wrapper.blockchainStatus = doc.Blockchain_Status__c;
                wrapper.registrationTimestamp = doc.Registration_Timestamp__c;
                wrapper.blockchainResponse = doc.Blockchain_Response__c;
                wrapper.errorMessage = doc.Error_Message__c;
                wrapper.metadata = doc.Metadata__c;
                wrapper.isRegistered = doc.Blockchain_Status__c == 'Registered';
            } else {
                wrapper.blockchainStatus = 'Not Registered';
                wrapper.isRegistered = false;
            }

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to get blockchain status: ' + e.getMessage());
            wrapper.blockchainStatus = 'Error';
            wrapper.errorMessage = e.getMessage();
            wrapper.isRegistered = false;
        }

        return wrapper;
    }

    /**
     * @description Search documents by name or hash
     * @param searchTerm Search term to filter documents
     * @return List<DocumentWrapper> Filtered list of documents
     */
    @AuraEnabled
    public static List<DocumentWrapper> searchDocuments(String searchTerm) {
        List<DocumentWrapper> documentWrappers = new List<DocumentWrapper>();

        if (String.isBlank(searchTerm)) {
            return getDocuments(); // Return all documents if no search term
        }

        try {
            String searchPattern = '%' + searchTerm + '%';

            List<ContentDocument> documents = [
                SELECT Id, Title, FileType, ContentSize, CreatedDate, LastModifiedDate, OwnerId
                FROM ContentDocument
                WHERE IsDeleted = false
                AND (Title LIKE :searchPattern OR FileType LIKE :searchPattern)
                ORDER BY LastModifiedDate DESC
                LIMIT 50
            ];

            for (ContentDocument doc : documents) {
                DocumentWrapper wrapper = new DocumentWrapper();
                wrapper.id = doc.Id;
                wrapper.title = doc.Title;
                wrapper.fileType = doc.FileType;
                wrapper.contentSize = doc.ContentSize;
                wrapper.createdDate = doc.CreatedDate;
                wrapper.lastModifiedDate = doc.LastModifiedDate;
                wrapper.ownerId = doc.OwnerId;

                documentWrappers.add(wrapper);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to search documents: ' + e.getMessage());
        }

        return documentWrappers;
    }

    /**
     * @description Get recent document access activity
     * @param limitCount Number of recent entries to return
     * @return List<AccessLogWrapper> Recent access log entries
     */
    @AuraEnabled(cacheable=true)
    public static List<AccessLogWrapper> getRecentActivity(Integer limitCount) {
        List<AccessLogWrapper> logWrappers = new List<AccessLogWrapper>();

        if (limitCount == null || limitCount <= 0) {
            limitCount = 20;
        }

        try {
            List<Document_Access_Log__c> logs = [
                SELECT Id, Name, Document_ID__c, Document_Hash__c, Access_Type__c,
                       User_ID__c, Access_Timestamp__c, Status__c,
                       Blockchain_Response__c, Error_Message__c,
                       CreatedBy.Name
                FROM Document_Access_Log__c
                ORDER BY Access_Timestamp__c DESC
                LIMIT :limitCount
            ];

            // Collect all document IDs to query metadata
            Set<String> documentHashes = new Set<String>();
            for (Document_Access_Log__c log : logs) {
                if (String.isNotBlank(log.Document_Hash__c)) {
                    documentHashes.add(log.Document_Hash__c);
                }
            }

            // Query document metadata, keyed by hash so we can resolve fileName
            Map<String, Blockchain_Document__c> documentMap = new Map<String, Blockchain_Document__c>();
            for (Blockchain_Document__c doc : [
                SELECT Id, Document_ID__c, Document_Hash__c, Metadata__c, File_Name__c
                FROM Blockchain_Document__c
                WHERE Document_Hash__c IN :documentHashes
            ]) {
                if (String.isNotBlank(doc.Document_Hash__c)) {
                    documentMap.put(doc.Document_Hash__c, doc);
                }
            }

            for (Document_Access_Log__c log : logs) {
                AccessLogWrapper wrapper = new AccessLogWrapper();
                wrapper.id = log.Id;
                wrapper.documentId = log.Document_ID__c;
                wrapper.documentHash = log.Document_Hash__c;
                wrapper.accessType = log.Access_Type__c;
                wrapper.userId = log.User_ID__c;
                wrapper.accessTimestamp = log.Access_Timestamp__c;
                wrapper.status = log.Status__c;
                wrapper.userName = log.CreatedBy.Name;
                wrapper.blockchainStatus = getBlockchainStatusForLog(log);

                // Get fileName from Blockchain_Document__c, preferring File_Name__c
                Blockchain_Document__c doc = documentMap.get(log.Document_Hash__c);
                if (doc != null) {
                    if (String.isNotBlank(doc.File_Name__c)) {
                        wrapper.fileName = doc.File_Name__c;
                    } else if (String.isNotBlank(doc.Metadata__c)) {
                        try {
                            Map<String, Object> metadata = (Map<String, Object>)JSON.deserializeUntyped(doc.Metadata__c);
                            if (metadata.containsKey('fileName')) {
                                wrapper.fileName = (String)metadata.get('fileName');
                            }
                        } catch (Exception e) {
                            // Ignore parsing errors
                        }
                    }
                }

                logWrappers.add(wrapper);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve recent activity: ' + e.getMessage());
        }

        return logWrappers;
    }

    // Helper methods

    /**
     * @description Determine blockchain status for access log display
     * @param log Document_Access_Log__c record
     * @return String Display-friendly blockchain status
     */
    private static String getBlockchainStatusForLog(Document_Access_Log__c log) {
        if (String.isNotBlank(log.Blockchain_Response__c)) {
            return 'Logged to Blockchain';
        } else if (String.isNotBlank(log.Error_Message__c)) {
            return 'Blockchain Error';
        } else if (log.Status__c == 'Queued for Blockchain') {
            return 'Pending';
        } else {
            return 'Not Logged';
        }
    }

    // Wrapper classes for LWC data binding

    public class DocumentWrapper {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String title { get; set; }
        @AuraEnabled public String fileType { get; set; }
        @AuraEnabled public Integer contentSize { get; set; }
        @AuraEnabled public Datetime createdDate { get; set; }
        @AuraEnabled public Datetime lastModifiedDate { get; set; }
        @AuraEnabled public Id ownerId { get; set; }
        @AuraEnabled public String documentHash { get; set; }
        @AuraEnabled public String metadata { get; set; }
    }

    public class AccessLogWrapper {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public Id documentId { get; set; }
        @AuraEnabled public String documentHash { get; set; }
        @AuraEnabled public String accessType { get; set; }
        @AuraEnabled public Id userId { get; set; }
        @AuraEnabled public Datetime accessTimestamp { get; set; }
        @AuraEnabled public String ipAddress { get; set; }
        @AuraEnabled public String userAgent { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public String sessionId { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String blockchainStatus { get; set; }
        @AuraEnabled public String fileName { get; set; }
    }

    public class ComplianceStatsWrapper {
        @AuraEnabled public Integer totalDocuments { get; set; }
        @AuraEnabled public Integer blockchainRegistered { get; set; }
        @AuraEnabled public Integer totalAccessEvents { get; set; }
        @AuraEnabled public Integer recentAccessEvents { get; set; }
        @AuraEnabled public Map<String, Integer> blockchainStatusBreakdown { get; set; }
        @AuraEnabled public Map<String, Integer> accessTypeBreakdown { get; set; }
    }

    public class BlockchainDocumentWrapper {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public Id documentId { get; set; }
        @AuraEnabled public String documentHash { get; set; }
        @AuraEnabled public String blockchainStatus { get; set; }
        @AuraEnabled public Datetime registrationTimestamp { get; set; }
        @AuraEnabled public String blockchainResponse { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String metadata { get; set; }
        @AuraEnabled public Boolean isRegistered { get; set; }
    }

    public class DocumentUploadWrapper {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public Id documentId { get; set; }
        @AuraEnabled public String documentHash { get; set; }
        @AuraEnabled public String blockchainStatus { get; set; }
        @AuraEnabled public Datetime registrationTimestamp { get; set; }
        @AuraEnabled public String metadata { get; set; }
        @AuraEnabled public String fileName { get; set; }
        @AuraEnabled public String bucket { get; set; }
        @AuraEnabled public String path { get; set; }
    }
}