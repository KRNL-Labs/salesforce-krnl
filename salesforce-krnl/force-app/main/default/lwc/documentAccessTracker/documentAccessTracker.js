import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';
import getRecentActivity from '@salesforce/apex/DocumentAccessController.getRecentActivity';
import getUploadsForRecord from '@salesforce/apex/DocumentAccessController.getUploadsForRecord';
import getViewerUrl from '@salesforce/apex/DocumentAccessLogger.getViewerUrl';
import getWatermarkedViewerUrlForDirectUpload from '@salesforce/apex/DocumentAccessLogger.getWatermarkedViewerUrlForDirectUpload';
import registerDocumentOnBlockchain from '@salesforce/apex/DocumentAccessLogger.registerDocumentOnBlockchain';
import logDirectUploadAccess from '@salesforce/apex/DocumentAccessLogger.logDirectUploadAccess';

export default class DocumentAccessTracker extends LightningElement {
    @api recordId; // Current record ID if used in record page

    @track complianceStats = {};
    @track isProcessing = false;
    @track uploads = [];

    uploadColumns = [
        { label: 'File Name', fieldName: 'fileName', type: 'text' },
        { label: 'Hash', fieldName: 'documentHash', type: 'text' },
        { label: 'Status', fieldName: 'blockchainStatus', type: 'text' },
        {
            label: 'Uploaded At',
            fieldName: 'registrationTimestamp',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }
        },
        {
            type: 'button',
            typeAttributes: {
                label: { fieldName: 'actionLabel' },
                name: 'uploadAction',
                variant: 'neutral'
            }
        }
    ];

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
            // Load each data source independently so one failure doesn't break everything
            const stats = await getComplianceStats().catch(error => {
                // eslint-disable-next-line no-console
                console.error('Failed to load compliance stats', error);
                return {};
            });

            const recentActivity = await getRecentActivity({ limitCount: 20 }).catch(error => {
                // eslint-disable-next-line no-console
                console.error('Failed to load recent activity', error);
                return [];
            });

            let uploads = [];
            if (this.recordId) {
                uploads = await getUploadsForRecord({ recordId: this.recordId }).catch(error => {
                    // eslint-disable-next-line no-console
                    console.error('Failed to load uploads for record', error);
                    return [];
                });
            }

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

            this.uploads = this.decorateUploads(uploads);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to initialize DocumentAccessTracker data', error);
            this.showToast('Error', 'Failed to load dashboard data', 'error');
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
    // Document selection removed - auto-registration enabled

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

    async handleUploadSuccess(event) {
        // Wait 2-3 seconds for backend to process and register document
        const detail = event.detail || {};
        // eslint-disable-next-line no-console
        console.log('Direct upload success, waiting 3s before refresh', detail);

        // Show immediate feedback
        this.showToast(
            'Success',
            'File uploaded! Registering on blockchain...',
            'success'
        );

        // Wait 3 seconds to allow registration to complete
        setTimeout(async () => {
            try {
                // Re-fetch compliance stats and uploads
                const promises = [
                    getComplianceStats()
                ];

                if (this.recordId) {
                    promises.push(getUploadsForRecord({ recordId: this.recordId }));
                }

                const results = await Promise.all(promises);

                const stats = results[0];
                const uploads = this.recordId && results.length > 1 ? results[1] : [];

                // Update compliance stats
                this.complianceStats = stats || this.complianceStats;

                // Update uploads list
                this.uploads = this.decorateUploads(uploads || []);

                this.showToast(
                    'Success',
                    'Dashboard refreshed - check file status',
                    'success'
                );
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to refresh after upload', error);
                // Non-fatal: upload already succeeded, just refresh failed
            }
        }, 3000); // Wait 3 seconds
    }

    // Helper methods

    decorateUploads(uploads) {
        return (uploads || []).map((u) => {
            const isRegistered = u.blockchainStatus === 'Registered';
            return {
                ...u,
                actionLabel: isRegistered ? 'View / Download' : 'Register'
            };
        });
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

    get hasUploadsForRecord() {
        return this.uploads && this.uploads.length > 0;
    }

    async handleUploadRowAction(event) {
        const action = event.detail.action;
        const row = event.detail.row;

        if (!action || !row || action.name !== 'uploadAction') {
            return;
        }

        const isRegistered = row.blockchainStatus === 'Registered';

        if (isRegistered) {
            // View / Download for registered documents
            if (!row.path) {
                this.showToast('Error', 'No storage path available for this upload', 'error');
                return;
            }

            this.isProcessing = true;
            try {
                // Use the new watermarked viewer URL method that waits for KRNL + on-chain confirmation
                const url = await getWatermarkedViewerUrlForDirectUpload({
                    blockchainDocId: row.id,
                    path: row.path,
                    accessType: 'view'
                });

                if (!url) {
                    throw new Error('Backend did not return a viewer URL');
                }

                this.showToast('Success', 'Access logged on-chain. Opening document...', 'success');

                // eslint-disable-next-line no-console
                console.log('Opening document viewer URL:', url);

                // Try to open in new window, fall back to same window if popup blocked
                // eslint-disable-next-line no-undef
                const newWindow = window.open(url, '_blank');
                if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                    // Popup blocked - open in same window
                    // eslint-disable-next-line no-console
                    console.warn('Popup blocked, opening in same window');
                    // eslint-disable-next-line no-undef
                    window.location.href = url;
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to open uploaded document', error);
                this.showToast('Error', error.message || 'Failed to open uploaded document', 'error');
            } finally {
                this.isProcessing = false;
            }
        } else {
            // Register for non-registered documents
            if (!row.id) {
                this.showToast('Error', 'Missing document ID for registration', 'error');
                return;
            }

            this.isProcessing = true;
            try {
                const success = await registerDocumentOnBlockchain({ blockchainDocId: row.id });

                if (!success) {
                    throw new Error('Apex registration method returned false');
                }

                this.showToast(
                    'Success',
                    'Document registration submitted. Waiting for confirmation...',
                    'success'
                );

                // Give the backend/queueable a few seconds to complete the transaction,
                // then refresh compliance stats and uploads.
                setTimeout(async () => {
                    try {
                        const promises = [
                            getComplianceStats()
                        ];

                        if (this.recordId) {
                            promises.push(getUploadsForRecord({ recordId: this.recordId }));
                        }

                        const results = await Promise.all(promises);

                        const stats = results[0];
                        const uploads = this.recordId && results.length > 1 ? results[1] : [];

                        this.complianceStats = stats || this.complianceStats;
                        this.uploads = this.decorateUploads(uploads || []);

                        this.showToast(
                            'Success',
                            'Dashboard refreshed - check document status',
                            'success'
                        );
                    } catch (refreshError) {
                        // eslint-disable-next-line no-console
                        console.error('Failed to refresh after manual registration', refreshError);
                    } finally {
                        this.isProcessing = false;
                    }
                }, 5000);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to register document from row action', error);
                this.showToast('Error', 'Failed to register document on blockchain', 'error');
                this.isProcessing = false;
            }
        }
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title,
            message,
            variant
        });
        this.dispatchEvent(evt);
    }
}
