const jwt = require('jsonwebtoken');
const axios = require('axios');
const { logger } = require('../utils/logger');

/**
 * Validate JWT token middleware
 */
const validateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. No token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test_secret_for_development');
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('JWT validation failed:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

/**
 * Validate Salesforce token middleware.
 *
 * For this app we trust the headers/body coming from Apex/LWC instead of
 * doing an external REST call back to Salesforce. The middleware enforces
 * that a Salesforce session token header is present (in non-development
 * environments) and then populates req.user with basic context for logging
 * and multi-tenant routing.
 */
const validateSalesforceToken = async (req, res, next) => {
  const salesforceToken = req.header('X-Salesforce-Token');

  // In non-development environments, require that a Salesforce session token
  // header is present as a minimal guardrail.
  if (!salesforceToken && process.env.NODE_ENV !== 'development') {
    return res.status(401).json({
      success: false,
      error: 'Salesforce authentication required.'
    });
  }

  // In development mode, provide a fixed stub user for convenience.
  if (process.env.NODE_ENV === 'development') {
    req.user = {
      id: 'test_user_001',
      email: 'test@example.com',
      salesforceId: '0051234567890123',
      orgId: 'test_org'
    };
    return next();
  }

  // In production/other environments, trust the context that Apex/LWC sends
  // rather than calling Salesforce. We derive a minimal req.user from
  // headers and body so downstream code has org / user context.
  const instanceUrlHeader = req.header('X-Salesforce-Instance-Url') || process.env.SALESFORCE_INSTANCE_URL || null;
  const bodyUserId = (req.body && (req.body.userId || req.body.salesforceUserId)) || null;
  const bodyUserEmail = (req.body && (req.body.userEmail || req.body.salesforceUserEmail)) || null;
  const bodyOrgId = (req.body && (req.body.orgId || req.body.salesforceOrgId)) || null;

  req.user = {
    id: bodyUserId,
    email: bodyUserEmail,
    salesforceId: bodyUserId,
    orgId: bodyOrgId,
    instanceUrl: instanceUrlHeader
  };

  // Optionally attach a simple tenant context keyed by instance URL.
  if (instanceUrlHeader) {
    req.tenant = { orgId: instanceUrlHeader };
  }

  return next();
};

/**
 * Mock Salesforce validation for testing
 */
async function validateWithSalesforce(token, instanceUrlFromHeader) {
  const baseUrl = instanceUrlFromHeader || process.env.SALESFORCE_INSTANCE_URL;
  const apiVersion = process.env.SALESFORCE_API_VERSION || 'v60.0';

  if (!baseUrl) {
    throw new Error('SALESFORCE_INSTANCE_URL is not configured and no X-Salesforce-Instance-Url header was provided');
  }

  const url = `${baseUrl}/services/data/${apiVersion}/chatter/users/me`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeout: 5000
  });

  const data = response.data || {};

  return {
    id: data.id || null,
    email: data.email || null,
    salesforceId: data.id || null,
    orgId: data.organizationId || null,
    instanceUrl: baseUrl
  };
}

module.exports = {
  validateJWT,
  validateSalesforceToken
};