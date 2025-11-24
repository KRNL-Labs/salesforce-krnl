const winston = require('winston');
const util = require('util');

// Create logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'krnl-document-backend' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let metaString = '';
          if (Object.keys(meta).length) {
            try {
              metaString = JSON.stringify(meta, null, 2);
            } catch (err) {
              metaString = util.inspect(meta, { depth: 3, colors: false });
            }
          }
          return `${timestamp} [${level}]: ${message} ${metaString}`;
        })
      )
    })
  ]
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: process.env.LOG_FILE_PATH || './logs/error.log',
    level: 'error'
  }));

  logger.add(new winston.transports.File({
    filename: process.env.LOG_FILE_PATH || './logs/combined.log'
  }));
}

module.exports = { logger };