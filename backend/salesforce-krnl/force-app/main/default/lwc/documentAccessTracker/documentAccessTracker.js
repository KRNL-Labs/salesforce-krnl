import { LightningElement, track, wire, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';

// Apex Methods
import getDocuments from '@salesforce/apex/DocumentAccessController.getDocuments';
import getDocumentAccessLogs from '@salesforce/apex/DocumentAccessController.getDocumentAccessLogs';
import generateDocumentHash from '@salesforce/apex/DocumentHashUtil.generateHashForContentDocument';
import logDocumentAccess from '@salesforce/apex/DocumentAccessLogger.logDocumentAccess';
import registerDocumentOnBlockchain from '@salesforce/apex/DocumentAccessLogger.registerDocumentOnBlockchain';
import validateDocumentIntegrity from '@salesforce/apex/DocumentAccessLogger.validateDocumentIntegrity';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';

// Custom Labels
import LABEL_SUCCESS from '@salesforce/label/c.Success';
import LABEL_ERROR from '@salesforce/label/c.Error';
import LABEL_PROCESSING from '@salesforce/label/c.Processing';

export default class DocumentAccessTracker extends NavigationMixin(LightningElement) {
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

    // Wired data
    wiredDocuments;
    wiredAccessLogs;
    wiredComplianceStats;

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

    @wire(getDocuments)
    wireDocuments(result) {
        this.wiredDocuments = result;
        if (result.data) {
            this.documentOptions = result.data.map(doc => ({
                label: doc.title,
                value: doc.id,
                description: `${doc.fileType} • ${this.formatFileSize(doc.contentSize)}`
            }));
        } else if (result.error) {
            this.showToast(LABEL_ERROR, 'Failed to load documents', 'error');
        }
    }

    @wire(getComplianceStats)
    wireComplianceStats(result) {
        this.wiredComplianceStats = result;
        if (result.data) {
            this.complianceStats = result.data;
        }
    }

    @wire(getDocumentAccessLogs, { documentId: '$selectedDocumentId' })
    wireAccessLogs(result) {
        this.wiredAccessLogs = result;
        if (result.data && this.selectedDocumentId) {
            this.accessLogs = result.data.map(log => ({
                ...log,
                id: log.id,
                blockchainStatusClass: this.getBlockchainStatusClass(log.status)
            }));
        } else if (result.error && this.selectedDocumentId) {
            this.showToast(LABEL_ERROR, 'Failed to load access logs', 'error');
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
                // Find selected document details
                const documents = this.wiredDocuments.data;
                this.selectedDocument = documents.find(doc => doc.id === this.selectedDocumentId);

                // Generate document hash
                this.documentHash = await generateDocumentHash({
                    contentDocumentId: this.selectedDocumentId
                });

                // Check blockchain status
                await this.checkBlockchainStatus();

            } catch (error) {
                this.showToast(LABEL_ERROR, 'Failed to load document details', 'error');
                console.error('Document selection error:', error);
            } finally {
                this.isProcessing = false;
            }
        } else {
            this.selectedDocument = null;
            this.documentHash = '';
            this.blockchainStatus = 'Not Registered';
        }
    }

    async handleViewDocument(event) {
        await this.logAndExecuteAccess('view', () => {
            this.navigateToDocument();
        });
    }

    async handleDownloadDocument(event) {
        await this.logAndExecuteAccess('download', () => {
            this.downloadDocument();
        });
    }

    async handleRegisterBlockchain(event) {
        this.isProcessing = true;

        try {
            await registerDocumentOnBlockchain({
                contentDocumentId: this.selectedDocumentId
            });

            this.showToast(LABEL_SUCCESS, 'Document registration initiated', 'success');
            this.blockchainStatus = 'Pending';

            // Refresh compliance stats
            refreshApex(this.wiredComplianceStats);

        } catch (error) {
            this.showToast(LABEL_ERROR, 'Failed to register document on blockchain', 'error');
            console.error('Blockchain registration error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async handleValidateIntegrity(event) {
        this.isProcessing = true;

        try {
            const isValid = await validateDocumentIntegrity({
                contentDocumentId: this.selectedDocumentId
            });

            if (isValid) {
                this.showToast(LABEL_SUCCESS, 'Document integrity validated successfully', 'success');
            } else {
                this.showToast(LABEL_ERROR, 'Document integrity validation failed', 'error');
            }

        } catch (error) {
            this.showToast(LABEL_ERROR, 'Failed to validate document integrity', 'error');
            console.error('Integrity validation error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    handleUploadDocument(event) {
        this.showUploadModal = true;
    }

    handleCloseUpload(event) {
        this.showUploadModal = false;
    }

    async handleUploadFinished(event) {
        const uploadedFiles = event.detail.files;

        if (uploadedFiles.length > 0) {
            this.showToast(LABEL_SUCCESS, `${uploadedFiles.length} file(s) uploaded successfully`, 'success');
            this.showUploadModal = false;

            // Refresh documents list
            refreshApex(this.wiredDocuments);
            refreshApex(this.wiredComplianceStats);

            // Auto-register new documents on blockchain
            for (let file of uploadedFiles) {
                try {
                    await registerDocumentOnBlockchain({
                        contentDocumentId: file.documentId
                    });
                } catch (error) {
                    console.error('Auto-registration failed for:', file.name, error);
                }
            }
        }
    }

    // Helper methods
    async logAndExecuteAccess(accessType, callback) {
        this.isProcessing = true;

        try {
            // Log the access event
            await logDocumentAccess({
                contentDocumentId: this.selectedDocumentId,
                accessType: accessType,
                userId: null // Will use current user in Apex
            });

            // Execute the callback (view/download action)
            if (callback && typeof callback === 'function') {
                callback();
            }

            // Refresh access logs
            refreshApex(this.wiredAccessLogs);
            refreshApex(this.wiredComplianceStats);

            this.showToast(LABEL_SUCCESS, `Document ${accessType} logged successfully`, 'success');

        } catch (error) {
            this.showToast(LABEL_ERROR, `Failed to log document ${accessType}`, 'error');
            console.error('Access logging error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    navigateToDocument() {
        this[NavigationMixin.Navigate]({
            type: 'standard__namedPage',
            attributes: {
                pageName: 'filePreview'
            },
            state: {
                selectedRecordId: this.selectedDocumentId
            }
        });
    }

    downloadDocument() {
        // Create download link
        const downloadUrl = `/sfc/servlet.shepherd/document/download/${this.selectedDocumentId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = this.selectedDocument.title;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async checkBlockchainStatus() {
        try {
            // This would typically call an Apex method to check blockchain status
            // For now, we'll simulate the check
            this.blockchainStatus = 'Not Registered'; // Default

        } catch (error) {
            console.error('Blockchain status check error:', error);
            this.blockchainStatus = 'Unknown';
        }
    }

    getBlockchainStatusClass(status) {
        switch (status) {
            case 'Logged to Blockchain':
                return 'slds-text-color_success';
            case 'Pending':
                return 'slds-text-color_warning';
            case 'Blockchain Error':
                return 'slds-text-color_error';
            default:
                return '';
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(evt);
    }

    // Lifecycle hooks
    connectedCallback() {
        // Component initialization
        console.log('DocumentAccessTracker connected');
    }

    disconnectedCallback() {
        // Cleanup
        console.log('DocumentAccessTracker disconnected');
    }
}