// Authentication and Security Middleware for WebSocket and TCP connections
const crypto = require('crypto');

class AuthMiddleware {
  constructor() {
    this.authTokens = new Map();
    this.rateLimiter = new Map();
    this.blockedIPs = new Set();
    
    // Configuration
    this.config = {
      authEnabled: process.env.WS_AUTH_ENABLED === 'true',
      authToken: process.env.WS_AUTH_TOKEN,
      maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '100'),
      connectionTimeout: parseInt(process.env.WS_CONNECTION_TIMEOUT || '300000'),
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      jwtSecret: process.env.JWT_SECRET,
      corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    };

    // Periodic cleanup
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Validate authentication token
   * @param {string} token - Authentication token from client
   * @returns {boolean} - Whether token is valid
   */
  validateToken(token) {
    if (!this.config.authEnabled) {
      return true; // Auth disabled, allow all
    }

    if (!token) {
      return false;
    }

    // Simple token validation for now - enhance with JWT in production
    return token === this.config.authToken;
  }

  /**
   * Check rate limiting
   * @param {string} clientId - Unique client identifier
   * @returns {boolean} - Whether request should be allowed
   */
  checkRateLimit(clientId) {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;

    if (!this.rateLimiter.has(clientId)) {
      this.rateLimiter.set(clientId, []);
    }

    const requests = this.rateLimiter.get(clientId);
    // Remove old requests outside the window
    const recentRequests = requests.filter(time => time > windowStart);
    
    if (recentRequests.length >= this.config.rateLimitMaxRequests) {
      return false; // Rate limit exceeded
    }

    recentRequests.push(now);
    this.rateLimiter.set(clientId, recentRequests);
    return true;
  }

  /**
   * Extract authentication from request
   * @param {object} req - HTTP request object
   * @returns {object} - Auth info { token, clientId }
   */
  extractAuth(req) {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    
    return { token, clientId };
  }

  /**
   * Check if IP is blocked
   * @param {string} ip - Client IP address
   * @returns {boolean} - Whether IP is blocked
   */
  isIPBlocked(ip) {
    return this.blockedIPs.has(ip);
  }

  /**
   * Block an IP address
   * @param {string} ip - IP to block
   * @param {number} duration - Block duration in ms (default: 1 hour)
   */
  blockIP(ip, duration = 3600000) {
    this.blockedIPs.add(ip);
    setTimeout(() => this.blockedIPs.delete(ip), duration);
  }

  /**
   * Validate and sanitize input
   * @param {any} input - Input to validate
   * @returns {object} - { valid, sanitized, error }
   */
  validateInput(input) {
    try {
      // Check if input is a string
      if (typeof input !== 'string') {
        return { valid: false, error: 'Input must be a string' };
      }

      // Check maximum size
      const maxSize = parseInt(process.env.MAX_REQUEST_SIZE || '10485760');
      if (input.length > maxSize) {
        return { valid: false, error: 'Input too large' };
      }

      // Parse JSON if applicable
      let parsed;
      try {
        parsed = JSON.parse(input);
      } catch {
        // Not JSON, treat as plain string
        parsed = input;
      }

      // Validate JSON-RPC structure if applicable
      if (typeof parsed === 'object' && parsed.jsonrpc) {
        if (parsed.jsonrpc !== '2.0') {
          return { valid: false, error: 'Invalid JSON-RPC version' };
        }
        if (!parsed.method && !parsed.id) {
          return { valid: false, error: 'Invalid JSON-RPC structure' };
        }
      }

      // Sanitize potentially dangerous content
      const sanitized = this.sanitizeContent(parsed);

      return { valid: true, sanitized };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Sanitize content to prevent injection attacks
   * @param {any} content - Content to sanitize
   * @returns {any} - Sanitized content
   */
  sanitizeContent(content) {
    if (typeof content === 'string') {
      // Remove potential script injection patterns
      return content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    
    if (typeof content === 'object' && content !== null) {
      const sanitized = Array.isArray(content) ? [] : {};
      for (const key in content) {
        if (content.hasOwnProperty(key)) {
          // Sanitize keys to prevent prototype pollution
          const sanitizedKey = key.replace(/[^\w\s-_.]/g, '');
          if (sanitizedKey !== '__proto__' && sanitizedKey !== 'constructor' && sanitizedKey !== 'prototype') {
            sanitized[sanitizedKey] = this.sanitizeContent(content[key]);
          }
        }
      }
      return sanitized;
    }
    
    return content;
  }

  /**
   * Generate secure connection token
   * @returns {string} - Secure token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash sensitive data
   * @param {string} data - Data to hash
   * @returns {string} - Hashed data
   */
  hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Clean up expired data
   */
  cleanup() {
    // Clean up rate limiter
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;
    
    for (const [clientId, requests] of this.rateLimiter.entries()) {
      const recentRequests = requests.filter(time => time > windowStart);
      if (recentRequests.length === 0) {
        this.rateLimiter.delete(clientId);
      } else {
        this.rateLimiter.set(clientId, recentRequests);
      }
    }
  }

  /**
   * Log security event
   * @param {string} event - Event type
   * @param {object} details - Event details
   */
  logSecurityEvent(event, details) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      event,
      ...details
    };
    
    console.log(`[SECURITY] ${JSON.stringify(logEntry)}`);
  }
}

module.exports = AuthMiddleware;