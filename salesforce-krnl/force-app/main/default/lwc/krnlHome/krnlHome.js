import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';
import getRecentActivity from '@salesforce/apex/DocumentAccessController.getRecentActivity';
import getSessionDetails from '@salesforce/apex/DocumentAccessController.getSessionDetails';

export default class KrnlHome extends LightningElement {
    @track stats = {
        totalDocuments: 0,
        blockchainRegistered: 0,
        totalAccessEvents: 0
    };

    @track recentAccessLogs = [];
    @track pagedRecentAccessLogs = [];
    @track recentSearchTerm = '';

    recentPage = 1;
    recentPageSize = 10;
    _recentFilteredCount = 0;
    @track showSessionModal = false;
    @track selectedSessionDetails = null;
    @track isLoadingSessionDetails = false;

    accessLogColumns = [
        {
            label: 'Time',
            fieldName: 'timestamp',
            type: 'date',
            typeAttributes: {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            },
            cellAttributes: { alignment: 'center' }
        },
        { label: 'Document', fieldName: 'documentName', type: 'text', cellAttributes: { alignment: 'center' } },
        { label: 'Access Type', fieldName: 'accessType', type: 'text', cellAttributes: { alignment: 'center' } },
        { label: 'User', fieldName: 'userName', type: 'text', cellAttributes: { alignment: 'center' } },
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
            cellAttributes: { alignment: 'center' }
        }
    ];

    connectedCallback() {
        this.initializeData();
    }

    async initializeData() {
        try {
            const [stats, recent] = await Promise.all([
                getComplianceStats(),
                getRecentActivity({ limitCount: 20 })
            ]);

            this.stats = stats || this.stats;

            this.recentAccessLogs = (recent || []).map((log) => ({
                id: log.id,
                timestamp: log.accessTimestamp,
                documentName: log.fileName || log.documentId,
                accessType: log.accessType,
                userName: log.userName,
                sessionId: log.sessionId || null,
                sessionLabel: log.sessionId || 'N/A',
                sessionButtonDisabled: !log.sessionId
            }));

            this.refreshPagedRecentAccess();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to initialize KRNL Home data', error);
        }
    }

    get totalDocuments() {
        return this.stats.totalDocuments || 0;
    }

    get blockchainRegistered() {
        return this.stats.blockchainRegistered || 0;
    }

    get totalAccessEvents() {
        return this.stats.totalAccessEvents || 0;
    }

    get complianceCoverage() {
        const total = this.totalDocuments;
        if (!total) {
            return 0;
        }
        return Math.round((this.blockchainRegistered / total) * 100);
    }

    get hasRecentAccess() {
        return this.recentAccessLogs && this.recentAccessLogs.length > 0;
    }

    // Pagination + search helpers for recent access logs
    refreshPagedRecentAccess() {
        const all = this.recentAccessLogs || [];
        const term = (this.recentSearchTerm || '').toLowerCase().trim();

        let filtered = all;
        if (term) {
            filtered = all.filter((row) => {
                const doc = (row.documentName || '').toLowerCase();
                const user = (row.userName || '').toLowerCase();
                const type = (row.accessType || '').toLowerCase();
                const session = (row.sessionId || '').toLowerCase();
                return (
                    doc.includes(term) ||
                    user.includes(term) ||
                    type.includes(term) ||
                    session.includes(term)
                );
            });
        }

        this._recentFilteredCount = filtered.length;

        const totalPages = this.recentTotalPages;
        if (this.recentPage > totalPages) {
            this.recentPage = totalPages || 1;
        }

        const start = (this.recentPage - 1) * this.recentPageSize;
        const end = start + this.recentPageSize;
        this.pagedRecentAccessLogs = filtered.slice(start, end);
    }

    get recentTotalPages() {
        if (!this._recentFilteredCount) {
            return 1;
        }
        return Math.ceil(this._recentFilteredCount / this.recentPageSize);
    }

    get isRecentPrevDisabled() {
        return this.recentPage <= 1;
    }

    get isRecentNextDisabled() {
        return this.recentPage >= this.recentTotalPages;
    }

    handleRecentSearchChange(event) {
        this.recentSearchTerm = event.target.value;
        this.recentPage = 1;
        this.refreshPagedRecentAccess();
    }

    handleRecentPrevPage() {
        if (this.recentPage > 1) {
            this.recentPage -= 1;
            this.refreshPagedRecentAccess();
        }
    }

    handleRecentNextPage() {
        if (this.recentPage < this.recentTotalPages) {
            this.recentPage += 1;
            this.refreshPagedRecentAccess();
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
