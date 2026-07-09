'use strict';

/**
 * Centralized Logging System
 * Provides structured logging with levels, context, and output to console.
 * In production, can be extended to write to files or external services.
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL_NAMES = {
  0: 'ERROR',
  1: 'WARN',
  2: 'INFO',
  3: 'DEBUG',
};

// Current log level (can be set via LOG_LEVEL env var)
const currentLevel = process.env.LOG_LEVEL 
  ? (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] ?? LOG_LEVELS.INFO)
  : LOG_LEVELS.INFO;

/**
 * Formats a log entry with timestamp, level, and context.
 */
function formatLog(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const levelName = LOG_LEVEL_NAMES[level];
  
  // Add context if provided
  let contextStr = '';
  if (Object.keys(context).length > 0) {
    contextStr = ` ${JSON.stringify(context)}`;
  }
  
  return `[${timestamp}] [${levelName}] ${message}${contextStr}`;
}

/**
 * Logs an error message.
 */
function error(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.ERROR) {
    console.error(formatLog(LOG_LEVELS.ERROR, message, context));
  }
}

/**
 * Logs a warning message.
 */
function warn(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.WARN) {
    console.warn(formatLog(LOG_LEVELS.WARN, message, context));
  }
}

/**
 * Logs an info message.
 */
function info(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.INFO) {
    console.log(formatLog(LOG_LEVELS.INFO, message, context));
  }
}

/**
 * Logs a debug message.
 */
function debug(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.DEBUG) {
    console.log(formatLog(LOG_LEVELS.DEBUG, message, context));
  }
}

/**
 * Creates a child logger with preset context.
 */
function child(context) {
  return {
    error: (message, additionalContext = {}) => error(message, { ...context, ...additionalContext }),
    warn: (message, additionalContext = {}) => warn(message, { ...context, ...additionalContext }),
    info: (message, additionalContext = {}) => info(message, { ...context, ...additionalContext }),
    debug: (message, additionalContext = {}) => debug(message, { ...context, ...additionalContext }),
  };
}

module.exports = {
  error,
  warn,
  info,
  debug,
  child,
  LOG_LEVELS,
};
