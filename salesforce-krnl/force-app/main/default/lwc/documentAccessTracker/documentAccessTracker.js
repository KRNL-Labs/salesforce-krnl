import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDocuments from '@salesforce/apex/DocumentAccessController.getDocuments';
import getDocumentAccessLogs from '@salesforce/apex/DocumentAccessController.getDocumentAccessLogs';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';
import getBlockchainDocumentStatus from '@salesforce/apex/DocumentAccessController.getBlockchainDocumentStatus';
import getRecentActivity from '@salesforce/apex/DocumentAccessController.getRecentActivity';
import logDocumentAccess from '@salesforce/apex/DocumentAccessLogger.logDocumentAccess';
import registerDocumentOnBlockchain from '@salesforce/apex/DocumentAccessLogger.registerDocumentOnBlockchain';
import validateDocumentIntegrityApex from '@salesforce/apex/DocumentAccessLogger.validateDocumentIntegrity';
import generateHashForContentDocument from '@salesforce/apex/DocumentHashUtil.generateHashForContentDocument';
import USER_ID from '@salesforce/user/Id';

export default class DocumentAccessTracker extends LightningElement {
    @api recordId; // Current record ID if used in record page

    @track documentOptions = [];
    @track selectedDocumentId = '';
    @track selectedDocument = null;
    @track documentHash = '';
    @track blockchainStatus = 'Not Registered';
    @track accessLogs = [];
    @track complianceStats = {};
    @track isProcessing = false;
    @track showUploadModal = false;

    // Mock data for local development
    mockDocuments = [
        {
            id: '0691234567890123',
            title: 'Sample Contract.pdf',
            fileType: 'PDF',
            contentSize: 1024576,
            label: 'Sample Contract.pdf',
            value: '0691234567890123'
        },
        {
            id: '0691234567890124',
            title: 'Legal Document.docx',
            fileType: 'WORD',
            contentSize: 2048576,
            label: 'Legal Document.docx',
            value: '0691234567890124'
        },
        {
            id: '0691234567890125',
            title: 'Compliance Report.xlsx',
            fileType: 'EXCEL',
            contentSize: 512288,
            label: 'Compliance Report.xlsx',
            value: '0691234567890125'
        }
    ];

    mockAccessLogs = [
        {
            id: 'log_001',
            accessTimestamp: new Date(Date.now() - 3600000),
            accessType: 'view',
            userName: 'John Doe',
            status: 'Completed',
            blockchainStatus: 'Logged',
            blockchainStatusClass: 'slds-text-color_success'
        },
        {
            id: 'log_002',
            accessTimestamp: new Date(Date.now() - 7200000),
            accessType: 'download',
            userName: 'Jane Smith',
            status: 'Completed',
            blockchainStatus: 'Logged',
            blockchainStatusClass: 'slds-text-color_success'
        },
        {
            id: 'log_003',
            accessTimestamp: new Date(Date.now() - 86400000),
            accessType: 'view',
            userName: 'Bob Johnson',
            status: 'Completed',
            blockchainStatus: 'Pending',
            blockchainStatusClass: 'slds-text-color_warning'
        }
    ];

    mockComplianceStats = {
        totalDocuments: 150,
        blockchainRegistered: 135,
        totalAccessEvents: 1247
    };

    // Access log columns for datatable
    accessLogColumns = [
        {
            label: 'Access Time',
            fieldName: 'accessTimestamp',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }
        },
        { label: 'Access Type', fieldName: 'accessType', type: 'text' },
        { label: 'User', fieldName: 'userName', type: 'text' },
        { label: 'Status', fieldName: 'status', type: 'text' },
        {
            label: 'Blockchain Status',
            fieldName: 'blockchainStatus',
            type: 'text',
            cellAttributes: {
                class: { fieldName: 'blockchainStatusClass' }
            }
        }
    ];

    // Lifecycle hook
    connectedCallback() {
        console.log('DocumentAccessTracker connected');
        this.initializeData();
    }

    async initializeData() {
        this.isProcessing = true;
        try {
            const [documents, stats, recentActivity] = await Promise.all([
                getDocuments(),
                getComplianceStats(),
                getRecentActivity({ limitCount: 20 })
            ]);

            this.documentOptions = (documents || []).map((doc) => ({
                ...doc,
                label: doc.title,
                value: doc.id
            }));

            this.complianceStats = stats || {};

            this.accessLogs = (recentActivity || []).map((log) => ({
                id: log.id,
                accessTimestamp: log.accessTimestamp,
                accessType: log.accessType,
                userName: log.userName,
                status: log.status,
                blockchainStatus: log.blockchainStatus,
                blockchainStatusClass: this.getBlockchainStatusClass(log.blockchainStatus)
            }));
        } catch (error) {
            // Fallback to mock data in case of errors (local development)
            // eslint-disable-next-line no-console
            console.error('Failed to initialize DocumentAccessTracker data, falling back to mocks', error);
            this.documentOptions = this.mockDocuments;
            this.complianceStats = this.mockComplianceStats;
            this.accessLogs = this.mockAccessLogs;
        } finally {
            this.isProcessing = false;
        }
    }

    // Computed properties
    get hasAccessLogs() {
        return this.accessLogs && this.accessLogs.length > 0;
    }

    get blockchainStatusVariant() {
        switch (this.blockchainStatus) {
            case 'Registered':
                return 'success';
            case 'Pending':
                return 'warning';
            case 'Failed':
                return 'error';
            default:
                return 'light';
        }
    }

    get isBlockchainRegistered() {
        return this.blockchainStatus === 'Registered';
    }

    get totalDocuments() {
        return this.complianceStats.totalDocuments || 0;
    }

    get blockchainRegisteredCount() {
        return this.complianceStats.blockchainRegistered || 0;
    }

    get totalAccessEvents() {
        return this.complianceStats.totalAccessEvents || 0;
    }

    // Event handlers
    async handleDocumentSelection(event) {
        this.selectedDocumentId = event.detail.value;

        if (this.selectedDocumentId) {
            this.isProcessing = true;

            try {
                this.selectedDocument = (this.documentOptions || []).find(
                    (doc) => doc.id === this.selectedDocumentId
                );

                const [hash, blockchainDoc, logs] = await Promise.all([
                    generateHashForContentDocument({ contentDocumentId: this.selectedDocumentId }),
                    getBlockchainDocumentStatus({ documentId: this.selectedDocumentId }),
                    getDocumentAccessLogs({ documentId: this.selectedDocumentId })
                ]);

                this.documentHash = hash;
                this.blockchainStatus =
                    blockchainDoc && blockchainDoc.blockchainStatus
                        ? blockchainDoc.blockchainStatus
                        : 'Not Registered';

                this.accessLogs = (logs || []).map((log) => ({
                    id: log.id,
                    accessTimestamp: log.accessTimestamp,
                    accessType: log.accessType,
                    userName: log.userName,
                    status: log.status,
                    blockchainStatus: log.blockchainStatus,
                    blockchainStatusClass: this.getBlockchainStatusClass(log.blockchainStatus)
                }));

                this.showToast('Success', 'Document loaded successfully', 'success');
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to load document data', error);
                this.showToast('Error', 'Failed to load document data', 'error');
            } finally {
                this.isProcessing = false;
            }
        } else {
            this.selectedDocument = null;
            this.documentHash = '';
            this.blockchainStatus = 'Not Registered';
            this.accessLogs = [];
        }
    }

    async handleViewDocument() {
        await this.logAndExecuteAccess('view', () => {
            this.showToast('Info', 'Document view would open in real environment', 'info');
        });
    }

    async handleDownloadDocument() {
        await this.logAndExecuteAccess('download', () => {
            this.showToast('Info', 'Document download would start in real environment', 'info');
        });
    }

    async handleRegisterBlockchain() {
        if (!this.selectedDocumentId) {
            this.showToast('Error', 'Please select a document before registering on blockchain', 'error');
            return;
        }

        this.isProcessing = true;
        try {
            await registerDocumentOnBlockchain({ contentDocumentId: this.selectedDocumentId });

            const blockchainDoc = await getBlockchainDocumentStatus({
                documentId: this.selectedDocumentId
            });

            this.blockchainStatus =
                blockchainDoc && blockchainDoc.blockchainStatus
                    ? blockchainDoc.blockchainStatus
                    : 'Registered';

            // Refresh compliance stats to keep dashboard in sync
            const stats = await getComplianceStats();
            this.complianceStats = stats || this.complianceStats;

            this.showToast(
                'Success',
                'Document registered on blockchain and status updated',
                'success'
            );
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to register document on blockchain', error);
            this.showToast('Error', 'Failed to register document on blockchain', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    async handleValidateIntegrity() {
        if (!this.selectedDocumentId) {
            this.showToast('Error', 'Please select a document before validating integrity', 'error');
            return;
        }

        this.isProcessing = true;
        try {
            const isValid = await validateDocumentIntegrityApex({
                contentDocumentId: this.selectedDocumentId
            });

            const message = isValid
                ? 'Document integrity validated successfully'
                : 'Document integrity validation failed';
            const variant = isValid ? 'success' : 'error';

            this.showToast(isValid ? 'Success' : 'Error', message, variant);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Document integrity validation failed', error);
            this.showToast('Error', 'Document integrity validation failed', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    handleUploadDocument() {
        this.showUploadModal = true;
    }

    handleCloseUpload() {
        this.showUploadModal = false;
    }

    handleUploadFinished(event) {
        this.showUploadModal = false;

        const uploadedFiles = (event && event.detail && event.detail.files) ? event.detail.files : [];

        if (!uploadedFiles.length) {
            this.showToast('Error', 'No files were uploaded', 'error');
            return;
        }

        const newDocs = uploadedFiles.map((file) => ({
            id: file.documentId,
            title: file.name,
            fileType: 'Uploaded',
            contentSize: 0,
            label: file.name,
            value: file.documentId
        }));

        this.documentOptions = [...this.documentOptions, ...newDocs];

        const addedCount = newDocs.length;
        const currentTotal = this.complianceStats.totalDocuments || 0;
        this.complianceStats = {
            ...this.complianceStats,
            totalDocuments: currentTotal + addedCount
        };

        this.showToast(
            'Success',
            `${addedCount} file${addedCount > 1 ? 's' : ''} uploaded successfully`,
            'success'
        );
    }

    // Helper methods
    async logAndExecuteAccess(accessType, callback) {
        if (!this.selectedDocumentId) {
            this.showToast('Error', 'Please select a document first', 'error');
            return;
        }

        this.isProcessing = true;
        try {
            await logDocumentAccess({
                contentDocumentId: this.selectedDocumentId,
                accessType,
                userId: USER_ID
            });

            const [logs, stats] = await Promise.all([
                getDocumentAccessLogs({ documentId: this.selectedDocumentId }),
                getComplianceStats()
            ]);

            this.accessLogs = (logs || []).map((log) => ({
                id: log.id,
                accessTimestamp: log.accessTimestamp,
                accessType: log.accessType,
                userName: log.userName,
                status: log.status,
                blockchainStatus: log.blockchainStatus,
                blockchainStatusClass: this.getBlockchainStatusClass(log.blockchainStatus)
            }));

            this.complianceStats = stats || this.complianceStats;

            if (callback && typeof callback === 'function') {
                callback();
            }

            this.showToast(
                'Success',
                `Document ${accessType} logged successfully`,
                'success'
            );
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to log document access', error);
            this.showToast('Error', 'Failed to log document access', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    generateMockHash(title) {
        // Generate a mock hash based on title
        const hash = btoa(title + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
        return '0x' + hash.toLowerCase().padEnd(64, '0');
    }

    getBlockchainStatusClass(status) {
        switch (status) {
            case 'Logged to Blockchain':
            case 'Registered':
                return 'slds-text-color_success';
            case 'Blockchain Error':
            case 'Registration Failed':
                return 'slds-text-color_error';
            case 'Pending':
                return 'slds-text-color_warning';
            default:
                return '';
        }
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(evt);
    }
}