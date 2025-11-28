import { LightningElement, track } from 'lwc';
import getComplianceStats from '@salesforce/apex/DocumentAccessController.getComplianceStats';
import getRecentActivity from '@salesforce/apex/DocumentAccessController.getRecentActivity';

export default class KrnlHome extends LightningElement {
    @track stats = {
        totalDocuments: 0,
        blockchainRegistered: 0,
        totalAccessEvents: 0
    };

    @track recentAccessLogs = [];

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
            }
        },
        { label: 'Document', fieldName: 'documentName', type: 'text' },
        { label: 'Access Type', fieldName: 'accessType', type: 'text' },
        { label: 'User', fieldName: 'userName', type: 'text' },
        { label: 'Blockchain Status', fieldName: 'blockchainStatus', type: 'text' }
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
                blockchainStatus: log.blockchainStatus || log.status
            }));
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
}
