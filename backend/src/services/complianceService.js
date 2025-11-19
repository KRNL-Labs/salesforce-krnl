const { logger } = require('../utils/logger');

class ComplianceService {
  constructor() {
    this.sessions = new Map(); // In-memory storage for testing
  }

  /**
   * Get document compliance data with pagination
   */
  async getDocumentCompliance(filters = {}) {
    const { page = 1, limit = 20, status, dateFrom, dateTo } = filters;

    // Mock compliance data for testing
    const mockDocuments = [
      {
        id: 'doc_001',
        documentHash: '0xa1b2c3d4e5f6789012345678901234567890abcdef1234567890123456789012',
        title: 'Sample Contract.pdf',
        complianceStatus: 'COMPLIANT',
        lastChecked: new Date().toISOString(),
        riskScore: 15,
        blockchainTxHash: '0x1234567890abcdef1234567890abcdef12345678'
      },
      {
        id: 'doc_002',
        documentHash: '0xb2c3d4e5f6a17890123456789012345678901cdef1234567890123456789013',
        title: 'Legal Document.docx',
        complianceStatus: 'NON_COMPLIANT',
        lastChecked: new Date(Date.now() - 86400000).toISOString(),
        riskScore: 85,
        blockchainTxHash: '0x2345678901bcdef12345678901cdef123456789'
      }
    ];

    // Apply filters (mock implementation)
    let filteredDocs = mockDocuments;
    if (status) {
      filteredDocs = filteredDocs.filter(doc => doc.complianceStatus === status);
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedDocs = filteredDocs.slice(startIndex, endIndex);

    return {
      documents: paginatedDocs,
      page,
      limit,
      total: filteredDocs.length
    };
  }

  /**
   * Get detailed compliance info for a specific document
   */
  async getDocumentComplianceDetails(documentHash) {
    logger.info(`Getting compliance details for document: ${documentHash}`);

    // Mock detailed compliance data
    return {
      documentHash,
      complianceStatus: 'COMPLIANT',
      lastChecked: new Date().toISOString(),
      checks: [
        {
          name: 'File Type Validation',
          status: 'PASSED',
          details: 'PDF file format is approved'
        },
        {
          name: 'Content Scanning',
          status: 'PASSED',
          details: 'No sensitive data detected'
        },
        {
          name: 'Signature Verification',
          status: 'PASSED',
          details: 'Digital signature valid'
        }
      ],
      riskAssessment: {
        score: 15,
        level: 'LOW',
        factors: ['Encrypted document', 'Valid signatures', 'Approved file type']
      },
      blockchainRecord: {
        txHash: '0x1234567890abcdef1234567890abcdef12345678',
        blockNumber: 12345678,
        timestamp: new Date().toISOString(),
        gasUsed: 125000
      }
    };
  }

  /**
   * Get audit trail for a document
   */
  async getDocumentAuditTrail(documentHash, includeBlockchain = true) {
    logger.info(`Getting audit trail for: ${documentHash}, blockchain: ${includeBlockchain}`);

    // Mock audit trail
    const auditEvents = [
      {
        eventType: 'DOCUMENT_UPLOADED',
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        userId: 'user_001',
        details: 'Document uploaded to Salesforce',
        source: 'SALESFORCE'
      },
      {
        eventType: 'COMPLIANCE_CHECK',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        userId: 'user_002',
        details: 'Automated compliance check passed',
        source: 'KRNL_WORKFLOW',
        txHash: includeBlockchain ? '0x1234567890abcdef' : null
      },
      {
        eventType: 'DOCUMENT_ACCESSED',
        timestamp: new Date(Date.now() - 43200000).toISOString(),
        userId: 'user_003',
        details: 'Document viewed',
        source: 'SALESFORCE',
        txHash: includeBlockchain ? '0x2345678901bcdef1' : null
      }
    ];

    return auditEvents;
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(params) {
    const { type, dateFrom, dateTo, includeDetails } = params;

    logger.info(`Generating ${type} compliance report from ${dateFrom} to ${dateTo}`);

    // Mock report data
    const report = {
      reportType: type,
      generatedAt: new Date().toISOString(),
      period: {
        from: dateFrom.toISOString(),
        to: dateTo.toISOString()
      },
      summary: {
        totalDocuments: 150,
        compliantDocuments: 135,
        nonCompliantDocuments: 15,
        averageRiskScore: 25.5,
        complianceRate: 90.0
      },
      byCategory: {
        'PDF Documents': { total: 100, compliant: 95, complianceRate: 95.0 },
        'Word Documents': { total: 30, compliant: 25, complianceRate: 83.3 },
        'Excel Documents': { total: 20, compliant: 15, complianceRate: 75.0 }
      },
      riskDistribution: {
        'LOW': 120,
        'MEDIUM': 25,
        'HIGH': 5
      }
    };

    if (includeDetails) {
      report.details = await this.getDocumentCompliance({ limit: 1000 });
    }

    return report;
  }

  /**
   * Format report as CSV
   */
  async formatReportAsCSV(report) {
    const header = 'Document Hash,Title,Status,Risk Score,Last Checked,Blockchain TX\n';

    if (!report.details || !report.details.documents) {
      return header + 'No detailed data available';
    }

    const rows = report.details.documents.map(doc =>
      `${doc.documentHash},${doc.title},${doc.complianceStatus},${doc.riskScore},${doc.lastChecked},${doc.blockchainTxHash}`
    ).join('\n');

    return header + rows;
  }

  /**
   * Validate document compliance
   */
  async validateDocumentCompliance(documentHashes, includeBlockchainCheck = true) {
    logger.info(`Validating compliance for ${documentHashes.length} documents`);

    const validationResults = documentHashes.map(hash => ({
      documentHash: hash,
      isCompliant: Math.random() > 0.2, // 80% compliance rate for testing
      complianceScore: Math.floor(Math.random() * 100),
      lastChecked: new Date().toISOString(),
      blockchainVerified: includeBlockchainCheck ? Math.random() > 0.1 : null,
      issues: Math.random() > 0.8 ? ['Outdated signature', 'Missing metadata'] : []
    }));

    return validationResults;
  }

  /**
   * Get compliance statistics
   */
  async getComplianceStatistics(period = '30d') {
    logger.info(`Getting compliance statistics for period: ${period}`);

    // Mock statistics based on period
    const stats = {
      period,
      totalDocuments: 150,
      compliantDocuments: 135,
      nonCompliantDocuments: 15,
      pendingReviews: 5,
      averageRiskScore: 25.5,
      complianceRate: 90.0,
      trends: {
        complianceRateChange: +2.5, // Percentage change
        riskScoreChange: -5.2,
        documentVolumeChange: +15.8
      },
      topRisks: [
        { risk: 'Outdated signatures', count: 8, severity: 'MEDIUM' },
        { risk: 'Missing metadata', count: 5, severity: 'LOW' },
        { risk: 'Unauthorized access', count: 2, severity: 'HIGH' }
      ],
      complianceByType: {
        contracts: { total: 80, compliant: 75, rate: 93.75 },
        invoices: { total: 40, compliant: 38, rate: 95.0 },
        reports: { total: 30, compliant: 22, rate: 73.33 }
      }
    };

    return stats;
  }

  /**
   * Create compliance alert
   */
  async createComplianceAlert(alertData) {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const alert = {
      id: alertId,
      ...alertData,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };

    // Store alert (in production, this would go to a database)
    logger.info(`Created compliance alert: ${alertId}`);

    return alert;
  }

  /**
   * Get compliance alerts
   */
  async getComplianceAlerts(filters = {}) {
    const { status = 'active', severity, type, page = 1, limit = 20 } = filters;

    // Mock alerts
    const mockAlerts = [
      {
        id: 'alert_001',
        documentHash: '0xa1b2c3d4e5f6789012345678901234567890abcdef',
        alertType: 'COMPLIANCE_FAILURE',
        severity: 'HIGH',
        description: 'Document failed compliance check',
        status: 'ACTIVE',
        createdAt: new Date(Date.now() - 3600000).toISOString()
      },
      {
        id: 'alert_002',
        documentHash: '0xb2c3d4e5f6a178901234567890123456789012cdef',
        alertType: 'INTEGRITY_ISSUE',
        severity: 'MEDIUM',
        description: 'Document hash mismatch detected',
        status: 'ACTIVE',
        createdAt: new Date(Date.now() - 7200000).toISOString()
      }
    ];

    // Apply filters
    let filteredAlerts = mockAlerts.filter(alert =>
      alert.status.toLowerCase() === status.toLowerCase()
    );

    if (severity) {
      filteredAlerts = filteredAlerts.filter(alert =>
        alert.severity.toLowerCase() === severity.toLowerCase()
      );
    }

    if (type) {
      filteredAlerts = filteredAlerts.filter(alert =>
        alert.alertType.toLowerCase() === type.toLowerCase()
      );
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedAlerts = filteredAlerts.slice(startIndex, endIndex);

    return {
      alerts: paginatedAlerts,
      page,
      limit,
      total: filteredAlerts.length
    };
  }
}

module.exports = ComplianceService;