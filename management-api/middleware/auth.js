/**
 * Bearer Token Authentication Middleware
 * Validates API tokens from Authorization header
 */

function createAuthMiddleware(validToken) {
  return async function authMiddleware(request, reply) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing Authorization header'
      });
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid Authorization format. Expected: Bearer <token>'
      });
    }

    if (token !== validToken) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Invalid API token'
      });
    }

    // Token is valid, continue to route handler
  };
}

module.exports = { createAuthMiddleware };
