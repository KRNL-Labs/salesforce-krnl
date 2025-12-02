import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';
import getRecentActivity from '@salesforce/apex/DocumentAccessController.getRecentActivity';
import getUploadsForRecord from '@salesforce/apex/DocumentAccessController.getUploadsForRecord';
import getDocumentAccessLogs from '@salesforce/apex/DocumentAccessController.getDocumentAccessLogs';
import getSessionDetails from '@salesforce/apex/DocumentAccessController.getSessionDetails';
import getViewerUrl from '@salesforce/apex/DocumentAccessLogger.getViewerUrl';
import getWatermarkedViewerUrlForDirectUpload from '@salesforce/apex/DocumentAccessLogger.getWatermarkedViewerUrlForDirectUpload';
import getViewerSessionUrlForDirectUpload from '@salesforce/apex/DocumentAccessLogger.getViewerSessionUrlForDirectUpload';
import registerDocumentOnBlockchain from '@salesforce/apex/DocumentAccessLogger.registerDocumentOnBlockchain';
import logDirectUploadAccess from '@salesforce/apex/DocumentAccessLogger.logDirectUploadAccess';

export default class DocumentAccessTracker extends LightningElement {
    @api recordId; // Current record ID if used in record page

    @track complianceStats = {};
    @track isProcessing = false;
    @track uploads = [];
    @track accessLogs = [];
    @track showSessionModal = false;
    @track selectedSessionDetails = null;
    @track isLoadingSessionDetails = false;

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
                variant: 'base',
                disabled: { fieldName: 'isOpening' }
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
            },
            initialWidth: 180
        },
        { label: 'File Name', fieldName: 'fileName', type: 'text', wrapText: true, initialWidth: 200 },
        { label: 'Access Type', fieldName: 'accessType', type: 'text', initialWidth: 100 },
        { label: 'User', fieldName: 'userName', type: 'text', initialWidth: 150 },
        {
            label: 'Session',
            fieldName: 'sessionId',
            type: 'button',
            typeAttributes: {
                label: { fieldName: 'sessionLabel' },
                name: 'viewSession',
                variant: 'base',
                disabled: { fieldName: 'sessionButtonDisabled' }
            },
            initialWidth: 260
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

            let rawAccessLogs = [];
            if (this.recordId) {
                rawAccessLogs = await getDocumentAccessLogs({ documentId: this.recordId }).catch(error => {
                    // eslint-disable-next-line no-console
                    console.error('Failed to load access logs for record', error);
                    return [];
                });
            } else {
                rawAccessLogs = await getRecentActivity({ limitCount: 20 }).catch(error => {
                    // eslint-disable-next-line no-console
                    console.error('Failed to load recent activity', error);
                    return [];
                });
            }

            let uploads = [];
            if (this.recordId) {
                uploads = await getUploadsForRecord({ recordId: this.recordId }).catch(error => {
                    // eslint-disable-next-line no-console
                    console.error('Failed to load uploads for record', error);
                    return [];
                });
            }

            this.complianceStats = stats || {};

            this.accessLogs = (rawAccessLogs || []).map((log) => ({
                id: log.id,
                accessTimestamp: log.accessTimestamp,
                accessType: log.accessType,
                userName: log.userName,
                status: log.status,
                blockchainStatus: log.blockchainStatus,
                blockchainStatusClass: this.getBlockchainStatusClass(log.blockchainStatus),
                fileName: log.fileName || '',
                sessionId: log.sessionId || null,
                sessionLabel: log.sessionId || 'N/A',
                sessionButtonDisabled: !log.sessionId
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
                actionLabel: isRegistered ? 'View' : 'Register',
                isOpening: false
            };
        });
    }

    setUploadOpeningState(rowId, isOpening) {
        this.uploads = (this.uploads || []).map((u) => {
            if (u.id !== rowId) {
                return u;
            }
            const isRegistered = u.blockchainStatus === 'Registered';
            return {
                ...u,
                isOpening,
                actionLabel: isOpening ? 'Opening…' : (isRegistered ? 'View' : 'Register')
            };
        });
    }

    renderViewerPlaceholder(win, fileName) {
        // No-op: the secure viewer now owns its own loading UI.
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

            try {
                this.setUploadOpeningState(row.id, true);
                const url = await getViewerSessionUrlForDirectUpload({
                    blockchainDocId: row.id,
                    path: row.path,
                    accessType: 'view'
                });

                if (!url) {
                    throw new Error('Backend did not return a viewer URL');
                }

                this.showToast('Success', 'Opening secure viewer...', 'success');

                // eslint-disable-next-line no-console
                console.log('Opening document viewer URL:', url);

                // eslint-disable-next-line no-undef
                const newWindow = window.open(url, '_blank');
                if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                    // eslint-disable-next-line no-console
                    console.warn('Popup blocked, secure viewer could not be opened in a new tab');
                    this.showToast(
                        'Warning',
                        'Browser blocked the secure viewer pop-up. Please allow pop-ups and try again.',
                        'warning'
                    );
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('Failed to open uploaded document', error);
                this.showToast('Error', error.message || 'Failed to open uploaded document', 'error');
            } finally {
                this.setUploadOpeningState(row.id, false);
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

    async handleAccessLogRowAction(event) {
        const action = event.detail.action;
        const row = event.detail.row;

        if (!action || action.name !== 'viewSession' || !row) {
            return;
        }

        const sessionId = row.sessionId;
        if (!sessionId) {
            return;
        }

        this.showSessionModal = true;
        this.isLoadingSessionDetails = true;
        this.selectedSessionDetails = null;

        try {
            const result = await getSessionDetails({ sessionId });
            if (!result || !result.success) {
                throw new Error('Failed to fetch session details');
            }

            // Transform status to user-friendly label
            let statusLabel = result.status;
            if (result.status === 'COMPLETED_WITH_EVENT') {
                statusLabel = 'Logged on Blockchain';
            }

            // Create Etherscan Sepolia URL for transaction hash
            const txHashUrl = result.txHash 
                ? `https://sepolia.etherscan.io/tx/${result.txHash}` 
                : null;

            // Format timestamp to human-readable format
            let formattedTimestamp = result.timestamp;
            if (result.timestamp) {
                try {
                    const date = new Date(result.timestamp);
                    formattedTimestamp = date.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });
                } catch (e) {
                    // Keep original if parsing fails
                    formattedTimestamp = result.timestamp;
                }
            }

            this.selectedSessionDetails = {
                sessionId: result.sessionId,
                userId: result.userId || 'Unknown',
                userIdUrl: result.userId ? `/${result.userId}` : null,
                status: statusLabel,
                accessHash: result.accessHash || null,
                txHash: result.txHash || null,
                txHashUrl: txHashUrl,
                fileName: result.fileName || 'Unknown',
                timestamp: formattedTimestamp
            };
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to load session details', error);
            const message = error && error.body && error.body.message
                ? error.body.message
                : (error && error.message ? error.message : 'Failed to load session details');
            this.showToast('Error', message, 'error');
            this.showSessionModal = false;
        } finally {
            this.isLoadingSessionDetails = false;
        }
    }

    handleCloseSessionModal() {
        this.showSessionModal = false;
        this.selectedSessionDetails = null;
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
