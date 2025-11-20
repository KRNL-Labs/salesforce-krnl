/**
 * @description Controller class for DocumentAccessTracker LWC component
 * @author Ash
 * @date 2024
 */
public with sharing class DocumentAccessController {

    /**
     * @description Get list of available documents
     * @return List<DocumentWrapper> List of documents with metadata
     */
    @AuraEnabled(cacheable=true)
    public static List<DocumentWrapper> getDocuments() {
        List<DocumentWrapper> documentWrappers = new List<DocumentWrapper>();

        try {
            List<ContentDocument> documents = [
                SELECT Id, Title, FileType, ContentSize, CreatedDate, LastModifiedDate, OwnerId
                FROM ContentDocument
                WHERE IsDeleted = false
                ORDER BY LastModifiedDate DESC
                LIMIT 100
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
            throw new AuraHandledException('Failed to retrieve documents: ' + e.getMessage());
        }

        return documentWrappers;
    }

    /**
     * @description Get access logs for a specific document
     * @param documentId ContentDocument ID (passed as String from LWC)
     * @return List<AccessLogWrapper> List of access log entries
     */
    @AuraEnabled(cacheable=true)
    public static List<AccessLogWrapper> getDocumentAccessLogs(String documentId) {
        List<AccessLogWrapper> logWrappers = new List<AccessLogWrapper>();

        if (String.isBlank(documentId)) {
            return logWrappers;
        }

        try {
            List<Document_Access_Log__c> logs = [
                SELECT Id, Name, Document_ID__c, Document_Hash__c, Access_Type__c,
                       User_ID__c, Access_Timestamp__c, IP_Address__c, User_Agent__c,
                       Status__c, Blockchain_Response__c, Error_Message__c,
                       CreatedBy.Name
                FROM Document_Access_Log__c
                WHERE Document_ID__c = :documentId
                ORDER BY Access_Timestamp__c DESC
                LIMIT 50
            ];

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
                wrapper.blockchainResponse = log.Blockchain_Response__c;
                wrapper.errorMessage = log.Error_Message__c;
                wrapper.userName = log.CreatedBy.Name;
                wrapper.blockchainStatus = getBlockchainStatusForLog(log);

                logWrappers.add(wrapper);
            }

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve access logs: ' + e.getMessage());
        }

        return logWrappers;
    }

    /**
     * @description Get compliance statistics and dashboard data
     * @return ComplianceStatsWrapper Compliance statistics
     */
    @AuraEnabled(cacheable=true)
    public static ComplianceStatsWrapper getComplianceStats() {
        ComplianceStatsWrapper stats = new ComplianceStatsWrapper();

        try {
            // Total documents count
            stats.totalDocuments = [SELECT COUNT() FROM ContentDocument WHERE IsDeleted = false];

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
        @AuraEnabled public String blockchainResponse { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String userName { get; set; }
        @AuraEnabled public String blockchainStatus { get; set; }
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
}