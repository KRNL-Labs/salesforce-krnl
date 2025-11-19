/**
 * @description Utility class for document hashing and blockchain integration
 * @author Ash
 * @date 2024
 */
public with sharing class DocumentHashUtil {

    /**
     * @description Generate SHA-256 hash for a document
     * @param documentContent Base64 encoded document content
     * @param documentMetadata JSON string containing document metadata
     * @return String SHA-256 hash of the document
     */
    public static String generateDocumentHash(String documentContent, String documentMetadata) {
        if (String.isBlank(documentContent)) {
            throw new DocumentHashException('Document content cannot be empty');
        }

        try {
            // Combine content and metadata for comprehensive hashing
            String combinedData = documentContent + (documentMetadata != null ? documentMetadata : '');

            // Generate SHA-256 hash
            Blob documentBlob = Blob.valueOf(combinedData);
            Blob hashBlob = Crypto.generateDigest('SHA-256', documentBlob);

            return EncodingUtil.convertToHex(hashBlob);
        } catch (Exception e) {
            throw new DocumentHashException('Failed to generate document hash: ' + e.getMessage());
        }
    }

    /**
     * @description Generate hash for a ContentDocument
     * @param contentDocumentId Salesforce ContentDocument ID
     * @return String SHA-256 hash of the document
     */
    @AuraEnabled(cacheable=true)
    public static String generateHashForContentDocument(Id contentDocumentId) {
        if (contentDocumentId == null) {
            throw new DocumentHashException('ContentDocument ID cannot be null');
        }

        try {
            // Query ContentVersion to get the actual file content
            ContentVersion cv = [
                SELECT VersionData, Title, FileExtension, ContentSize, CreatedDate
                FROM ContentVersion
                WHERE ContentDocumentId = :contentDocumentId
                AND IsLatest = true
                LIMIT 1
            ];

            // Create metadata object
            Map<String, Object> metadata = new Map<String, Object>{
                'title' => cv.Title,
                'extension' => cv.FileExtension,
                'size' => cv.ContentSize,
                'createdDate' => cv.CreatedDate.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                'salesforceId' => contentDocumentId
            };

            String metadataJson = JSON.serialize(metadata);
            String base64Content = EncodingUtil.base64Encode(cv.VersionData);

            return generateDocumentHash(base64Content, metadataJson);

        } catch (QueryException e) {
            throw new DocumentHashException('Document not found: ' + e.getMessage());
        } catch (Exception e) {
            throw new DocumentHashException('Failed to generate hash for ContentDocument: ' + e.getMessage());
        }
    }

    /**
     * @description Validate document integrity by comparing hashes
     * @param contentDocumentId Salesforce ContentDocument ID
     * @param expectedHash Expected hash value
     * @return Boolean true if hashes match, false otherwise
     */
    public static Boolean validateDocumentIntegrity(Id contentDocumentId, String expectedHash) {
        if (String.isBlank(expectedHash)) {
            throw new DocumentHashException('Expected hash cannot be empty');
        }

        try {
            String currentHash = generateHashForContentDocument(contentDocumentId);
            return currentHash.equals(expectedHash);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Document integrity validation failed: ' + e.getMessage());
            return false;
        }
    }

    /**
     * @description Create document metadata for blockchain storage
     * @param contentDocumentId Salesforce ContentDocument ID
     * @return Map<String, Object> Document metadata
     */
    public static Map<String, Object> createDocumentMetadata(Id contentDocumentId) {
        try {
            ContentDocument cd = [
                SELECT Title, FileType, ContentSize, CreatedDate, LastModifiedDate, OwnerId
                FROM ContentDocument
                WHERE Id = :contentDocumentId
                LIMIT 1
            ];

            User owner = [SELECT Name, Email FROM User WHERE Id = :cd.OwnerId LIMIT 1];

            return new Map<String, Object>{
                'salesforceId' => contentDocumentId,
                'title' => cd.Title,
                'fileType' => cd.FileType,
                'size' => cd.ContentSize,
                'createdDate' => cd.CreatedDate.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                'lastModifiedDate' => cd.LastModifiedDate.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                'owner' => new Map<String, Object>{
                    'id' => cd.OwnerId,
                    'name' => owner.Name,
                    'email' => owner.Email
                },
                'platform' => 'Salesforce',
                'version' => '1.0'
            };
        } catch (Exception e) {
            throw new DocumentHashException('Failed to create document metadata: ' + e.getMessage());
        }
    }

    /**
     * @description Batch process multiple documents for hash generation
     * @param contentDocumentIds List of ContentDocument IDs
     * @return Map<Id, String> Map of ContentDocument ID to hash
     */
    public static Map<Id, String> batchGenerateHashes(List<Id> contentDocumentIds) {
        Map<Id, String> hashResults = new Map<Id, String>();

        if (contentDocumentIds == null || contentDocumentIds.isEmpty()) {
            return hashResults;
        }

        List<ContentVersion> contentVersions = [
            SELECT ContentDocumentId, VersionData, Title, FileExtension, ContentSize, CreatedDate
            FROM ContentVersion
            WHERE ContentDocumentId IN :contentDocumentIds
            AND IsLatest = true
        ];

        for (ContentVersion cv : contentVersions) {
            try {
                Map<String, Object> metadata = new Map<String, Object>{
                    'title' => cv.Title,
                    'extension' => cv.FileExtension,
                    'size' => cv.ContentSize,
                    'createdDate' => cv.CreatedDate.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'salesforceId' => cv.ContentDocumentId
                };

                String metadataJson = JSON.serialize(metadata);
                String base64Content = EncodingUtil.base64Encode(cv.VersionData);
                String documentHash = generateDocumentHash(base64Content, metadataJson);

                hashResults.put(cv.ContentDocumentId, documentHash);

            } catch (Exception e) {
                System.debug(LoggingLevel.ERROR, 'Failed to generate hash for document ' +
                           cv.ContentDocumentId + ': ' + e.getMessage());
                // Continue processing other documents
            }
        }

        return hashResults;
    }

    /**
     * @description Custom exception for document hashing errors
     */
    public class DocumentHashException extends Exception {}
}