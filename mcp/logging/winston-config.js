const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure log directory exists
const logDir = process.env.LOG_DIR || '/app/mcp-logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
        format: 'HH:mm:ss'
    }),
    winston.format.printf(info => {
        return `${info.timestamp} [${info.level}]: ${info.message}`;
    })
);

// Create the logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'mcp-gateway' },
    transports: [
        // Write all logs with level 'error' to error.log
        new winston.transports.File({
            filename: path.join(logDir, 'error.json'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // Write all logs to combined.log
        new winston.transports.File({
            filename: path.join(logDir, 'combined.json'),
            maxsize: 10485760, // 10MB
            maxFiles: 10,
            tailable: true
        }),
        // Security audit log
        new winston.transports.File({
            filename: path.join(logDir, 'security/audit.json'),
            level: 'warn',
            maxsize: 10485760, // 10MB
            maxFiles: 20,
            tailable: true
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'exceptions.json')
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'rejections.json')
        })
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Performance monitoring helper
logger.performance = (operation, startTime) => {
    const duration = Date.now() - startTime;
    logger.info('Performance metric', {
        operation,
        duration,
        timestamp: new Date().toISOString()
    });
};

// Security audit helper
logger.security = (event, details) => {
    logger.warn('Security event', {
        event,
        ...details,
        timestamp: new Date().toISOString()
    });
};

module.exports = logger;