import { LightningElement, track } from 'lwc';

export default class KrnlHome extends LightningElement {
    @track stats = {
        totalDocuments: 150,
        blockchainRegistered: 135,
        totalAccessEvents: 1247
    };

    @track recentAccessLogs = [
        {
            id: 'log_001',
            timestamp: new Date(Date.now() - 3600000),
            documentName: 'Sample Contract.pdf',
            accessType: 'view',
            userName: 'John Doe',
            status: 'Completed'
        },
        {
            id: 'log_002',
            timestamp: new Date(Date.now() - 7200000),
            documentName: 'Legal Document.docx',
            accessType: 'download',
            userName: 'Jane Smith',
            status: 'Completed'
        },
        {
            id: 'log_003',
            timestamp: new Date(Date.now() - 86400000),
            documentName: 'Compliance Report.xlsx',
            accessType: 'view',
            userName: 'Bob Johnson',
            status: 'Completed'
        }
    ];

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
        { label: 'Status', fieldName: 'status', type: 'text' }
    ];

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
