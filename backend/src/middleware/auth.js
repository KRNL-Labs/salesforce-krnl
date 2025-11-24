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
 * Validate Salesforce token middleware (simplified for testing)
 */
const validateSalesforceToken = async (req, res, next) => {
  const salesforceToken = req.header('X-Salesforce-Token');

  if (!salesforceToken && process.env.NODE_ENV !== 'development') {
    return res.status(401).json({
      success: false,
      error: 'Salesforce authentication required.'
    });
  }

  // In development mode, skip Salesforce validation
  if (process.env.NODE_ENV === 'development') {
    req.user = {
      id: 'test_user_001',
      email: 'test@example.com',
      salesforceId: '0051234567890123',
      orgId: 'test_org'
    };
    return next();
  }

  try {
    // In production, validate against Salesforce
    // This would involve calling Salesforce API to validate the session
    const instanceUrlHeader = req.header('X-Salesforce-Instance-Url');
    const userInfo = await validateWithSalesforce(salesforceToken, instanceUrlHeader);
    req.user = userInfo;
    // Attach tenant context for multi-tenant scenarios based on Salesforce org
    if (userInfo && userInfo.orgId) {
      req.tenant = { orgId: userInfo.orgId };
    }
    next();
  } catch (error) {
    logger.error('Salesforce validation failed:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid Salesforce session.'
    });
  }
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