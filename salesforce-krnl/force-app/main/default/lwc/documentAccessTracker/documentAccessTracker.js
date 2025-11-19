import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

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
        console.log('DocumentAccessTracker connected - Local Development Mode');

        // Initialize with mock data
        this.documentOptions = this.mockDocuments;
        this.complianceStats = this.mockComplianceStats;
        this.accessLogs = this.mockAccessLogs;

        // Simulate some processing delay
        setTimeout(() => {
            this.isProcessing = false;
        }, 1000);
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

            // Find selected document details
            this.selectedDocument = this.mockDocuments.find(doc => doc.id === this.selectedDocumentId);

            // Simulate hash generation
            setTimeout(() => {
                this.documentHash = this.generateMockHash(this.selectedDocument.title);
                this.blockchainStatus = Math.random() > 0.3 ? 'Registered' : 'Not Registered';
                this.isProcessing = false;

                // Filter access logs for this document (simulate)
                this.accessLogs = this.mockAccessLogs.slice(0, Math.floor(Math.random() * 3) + 1);

                this.showToast('Success', 'Document loaded successfully', 'success');
            }, 1500);
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
        this.isProcessing = true;

        // Simulate blockchain registration
        setTimeout(() => {
            this.blockchainStatus = 'Registered';
            this.complianceStats.blockchainRegistered += 1;
            this.isProcessing = false;
            this.showToast('Success', 'Document registered on blockchain (simulated)', 'success');
        }, 3000);
    }

    async handleValidateIntegrity() {
        this.isProcessing = true;

        // Simulate integrity validation
        setTimeout(() => {
            const isValid = Math.random() > 0.1; // 90% success rate
            const message = isValid ?
                'Document integrity validated successfully' :
                'Document integrity validation failed';
            const variant = isValid ? 'success' : 'error';

            this.showToast(isValid ? 'Success' : 'Error', message, variant);
            this.isProcessing = false;
        }, 2000);
    }

    handleUploadDocument() {
        this.showUploadModal = true;
    }

    handleCloseUpload() {
        this.showUploadModal = false;
    }

    handleUploadFinished() {
        this.showUploadModal = false;
        this.showToast('Success', 'File upload would work in real environment', 'success');

        // Simulate adding a new document
        const newDoc = {
            id: '069' + Date.now(),
            title: 'Uploaded Document.pdf',
            fileType: 'PDF',
            contentSize: 1234567,
            label: 'Uploaded Document.pdf',
            value: '069' + Date.now()
        };

        this.documentOptions = [...this.documentOptions, newDoc];
        this.complianceStats.totalDocuments += 1;
    }

    // Helper methods
    async logAndExecuteAccess(accessType, callback) {
        this.isProcessing = true;

        // Simulate access logging
        setTimeout(() => {
            const newLog = {
                id: 'log_' + Date.now(),
                accessTimestamp: new Date(),
                accessType: accessType,
                userName: 'Current User (Demo)',
                status: 'Completed',
                blockchainStatus: 'Logged',
                blockchainStatusClass: 'slds-text-color_success'
            };

            this.accessLogs = [newLog, ...this.accessLogs];
            this.complianceStats.totalAccessEvents += 1;

            if (callback && typeof callback === 'function') {
                callback();
            }

            this.isProcessing = false;
            this.showToast('Success', `Document ${accessType} logged successfully`, 'success');
        }, 1000);
    }

    generateMockHash(title) {
        // Generate a mock hash based on title
        const hash = btoa(title + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 64);
        return '0x' + hash.toLowerCase().padEnd(64, '0');
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