/**
 * Structured JSON logger wrapper around Pino
 * Writes one JSON line per call with ts, level, msg, slot, method, impl, duration_ms, session_id, execution_id, outcome
 */

const pino = require('pino');

// Create base pino logger (stdout/stderr container-native)
const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined
});

/**
 * Log an adapter dispatch with structured fields
 * @param {Object} context - Log context
 * @param {string} context.level - Log level (info, warn, error)
 * @param {string} context.msg - Log message
 * @param {string} context.slot - Adapter slot
 * @param {string} context.method - Method name
 * @param {string} context.impl - Implementation
 * @param {number} context.duration_ms - Duration in milliseconds
 * @param {string} context.session_id - Session ID
 * @param {string} context.execution_id - Execution ID
 * @param {string} context.outcome - success | error
 * @param {*} context.data - Optional additional data
 */
function logAdapterDispatch(context) {
  const {
    level = 'info',
    msg,
    slot,
    method,
    impl,
    duration_ms,
    session_id,
    execution_id,
    outcome,
    data
  } = context;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    slot,
    method,
    impl,
    duration_ms,
    session_id,
    execution_id,
    outcome
  };

  if (data) {
    payload.data = data;
  }

  if (level === 'error') {
    baseLogger.error(payload);
  } else if (level === 'warn') {
    baseLogger.warn(payload);
  } else {
    baseLogger.info(payload);
  }
}

module.exports = {
  // Expose base pino logger for backward compatibility
  ...baseLogger,
  // Expose structured dispatch logger
  logAdapterDispatch,
  // Re-export base logger methods
  info: baseLogger.info.bind(baseLogger),
  warn: baseLogger.warn.bind(baseLogger),
  error: baseLogger.error.bind(baseLogger),
  debug: baseLogger.debug.bind(baseLogger)
};
