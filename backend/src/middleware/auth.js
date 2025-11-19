const jwt = require('jsonwebtoken');
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
    const userInfo = await validateWithSalesforce(salesforceToken);
    req.user = userInfo;
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
async function validateWithSalesforce(token) {
  // This would make an actual call to Salesforce in production
  // For now, return mock user data
  return {
    id: 'sf_user_001',
    email: 'user@company.com',
    salesforceId: '0051234567890123',
    orgId: 'production_org'
  };
}

module.exports = {
  validateJWT,
  validateSalesforceToken
};