// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./TargetBase.sol";

/**
 * @title DocumentAccessRegistry
 * @dev Smart contract for logging document access and maintaining compliance records
 * Integrates with Salesforce KRNL system for document access tracking
 */
contract DocumentAccessRegistry is TargetBase, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");
    bytes32 public constant DOCUMENT_MANAGER_ROLE = keccak256("DOCUMENT_MANAGER_ROLE");

    struct DocumentRecord {
        string documentHash;
        string salesforceRecordId;
        address registeredBy;
        uint256 registrationTimestamp;
        bool isActive;
        string metadata; // JSON metadata about the document
    }

    struct AccessLog {
        string documentHash;
        address accessor;
        string salesforceUserId;
        uint256 accessTimestamp;
        string accessType; // "view", "download", "modify"
        string ipAddress;
        string userAgent;
    }

    struct DocumentRegistrationParams {
        string documentHash;
        string salesforceRecordId;
        string metadata;
    }

    struct DocumentAccessParams {
        string documentHash;
        string salesforceUserId;
        string accessType;
        string ipAddress;
        string userAgent;
    }

    // Mappings
    mapping(string => DocumentRecord) public documents;
    mapping(string => AccessLog[]) public documentAccessLogs;
    mapping(address => bool) public authorizedSalesforceIntegrations;

    // Arrays for enumeration
    string[] public documentHashes;

    // Events
    event DocumentRegistered(
        string indexed documentHash,
        string salesforceRecordId,
        address registeredBy,
        uint256 timestamp
    );

    event DocumentAccessLogged(
        string indexed documentHash,
        address accessor,
        string salesforceUserId,
        string accessType,
        uint256 timestamp
    );

    event DocumentDeactivated(
        string indexed documentHash,
        address deactivatedBy,
        uint256 timestamp
    );

    event SalesforceIntegrationAuthorized(
        address integrationAddress,
        bool authorized,
        uint256 timestamp
    );

    constructor(
        address _admin,
        address _authKey,
        address _recoveryKey,
        address _owner
    ) TargetBase(_authKey, _recoveryKey, _owner) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(COMPLIANCE_OFFICER_ROLE, _admin);
        _grantRole(DOCUMENT_MANAGER_ROLE, _admin);
    }

    /**
     * @dev Register a new document in the blockchain registry
     * @param _documentHash SHA-256 hash of the document
     * @param _salesforceRecordId Salesforce record ID for the document
     * @param _metadata JSON metadata about the document
     */
    function registerDocumentKRNL(
        AuthData calldata authData
    ) external requireAuth(authData) whenNotPaused {
        DocumentRegistrationParams memory params = abi.decode(
            authData.result,
            (DocumentRegistrationParams)
        );

        _registerDocument(params.documentHash, params.salesforceRecordId, params.metadata);
    }

    function _registerDocument(
        string memory _documentHash,
        string memory _salesforceRecordId,
        string memory _metadata
    ) internal {
        require(bytes(_documentHash).length > 0, "Document hash cannot be empty");
        require(bytes(_salesforceRecordId).length > 0, "Salesforce record ID cannot be empty");
        require(!documentExists(_documentHash), "Document already registered");

        documents[_documentHash] = DocumentRecord({
            documentHash: _documentHash,
            salesforceRecordId: _salesforceRecordId,
            registeredBy: msg.sender,
            registrationTimestamp: block.timestamp,
            isActive: true,
            metadata: _metadata
        });

        documentHashes.push(_documentHash);

        emit DocumentRegistered(_documentHash, _salesforceRecordId, msg.sender, block.timestamp);
    }

    /**
     * @dev Log document access for compliance tracking
     * @param _documentHash Hash of the accessed document
     * @param _salesforceUserId Salesforce user ID who accessed the document
     * @param _accessType Type of access (view, download, modify)
     * @param _ipAddress IP address of the accessor
     * @param _userAgent User agent of the accessor
     */
    function logDocumentAccessKRNL(
        AuthData calldata authData
    ) external requireAuth(authData) whenNotPaused {
        DocumentAccessParams memory params = abi.decode(
            authData.result,
            (DocumentAccessParams)
        );

        _logDocumentAccess(
            params.documentHash,
            params.salesforceUserId,
            params.accessType,
            params.ipAddress,
            params.userAgent
        );
    }

    function _logDocumentAccess(
        string memory _documentHash,
        string memory _salesforceUserId,
        string memory _accessType,
        string memory _ipAddress,
        string memory _userAgent
    ) internal {
        require(documentExists(_documentHash), "Document not registered");
        require(documents[_documentHash].isActive, "Document is not active");
        require(
            authorizedSalesforceIntegrations[msg.sender] ||
            hasRole(DOCUMENT_MANAGER_ROLE, msg.sender),
            "Unauthorized to log access"
        );

        AccessLog memory newLog = AccessLog({
            documentHash: _documentHash,
            accessor: msg.sender,
            salesforceUserId: _salesforceUserId,
            accessTimestamp: block.timestamp,
            accessType: _accessType,
            ipAddress: _ipAddress,
            userAgent: _userAgent
        });

        documentAccessLogs[_documentHash].push(newLog);

        emit DocumentAccessLogged(
            _documentHash,
            msg.sender,
            _salesforceUserId,
            _accessType,
            block.timestamp
        );
    }

    /**
     * @dev Deactivate a document (soft delete)
     * @param _documentHash Hash of the document to deactivate
     */
    function deactivateDocument(
        string memory _documentHash
    ) external onlyRole(DOCUMENT_MANAGER_ROLE) whenNotPaused {
        require(documentExists(_documentHash), "Document not registered");
        require(documents[_documentHash].isActive, "Document already deactivated");

        documents[_documentHash].isActive = false;

        emit DocumentDeactivated(_documentHash, msg.sender, block.timestamp);
    }

    /**
     * @dev Authorize or revoke Salesforce integration access
     * @param _integrationAddress Address of the Salesforce integration
     * @param _authorized Whether to authorize or revoke access
     */
    function setSalesforceIntegrationAuth(
        address _integrationAddress,
        bool _authorized
    ) external onlyRole(COMPLIANCE_OFFICER_ROLE) {
        authorizedSalesforceIntegrations[_integrationAddress] = _authorized;

        emit SalesforceIntegrationAuthorized(_integrationAddress, _authorized, block.timestamp);
    }

    /**
     * @dev Get document information
     * @param _documentHash Hash of the document
     * @return DocumentRecord struct
     */
    function getDocument(
        string memory _documentHash
    ) external view returns (DocumentRecord memory) {
        require(documentExists(_documentHash), "Document not registered");
        return documents[_documentHash];
    }

    /**
     * @dev Get access logs for a document
     * @param _documentHash Hash of the document
     * @return Array of AccessLog structs
     */
    function getDocumentAccessLogs(
        string memory _documentHash
    ) external view returns (AccessLog[] memory) {
        require(documentExists(_documentHash), "Document not registered");
        return documentAccessLogs[_documentHash];
    }

    /**
     * @dev Get total number of registered documents
     * @return Number of documents
     */
    function getDocumentCount() external view returns (uint256) {
        return documentHashes.length;
    }

    /**
     * @dev Get document hash by index
     * @param _index Index of the document
     * @return Document hash
     */
    function getDocumentHashByIndex(uint256 _index) external view returns (string memory) {
        require(_index < documentHashes.length, "Index out of bounds");
        return documentHashes[_index];
    }

    /**
     * @dev Check if a document exists in the registry
     * @param _documentHash Hash of the document
     * @return True if document exists
     */
    function documentExists(string memory _documentHash) public view returns (bool) {
        return bytes(documents[_documentHash].documentHash).length > 0;
    }

    /**
     * @dev Get access log count for a document
     * @param _documentHash Hash of the document
     * @return Number of access logs
     */
    function getAccessLogCount(string memory _documentHash) external view returns (uint256) {
        require(documentExists(_documentHash), "Document not registered");
        return documentAccessLogs[_documentHash].length;
    }

    /**
     * @dev Emergency pause function
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause function
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}