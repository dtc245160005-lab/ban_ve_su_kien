const { parseCookies } = require('../lib/cookies');
const { redisClient } = require('../lib/redis');
const { createRedisAuthStore } = require('../services/redisAuthStore');

function createAuthMiddleware(options = {}) {
  const cookieName =
    options.cookieName || process.env.SESSION_COOKIE_NAME || 'session_token';
  const sessionStore =
    options.sessionStore ||
    createRedisAuthStore(options.redisClient || redisClient).sessionStore;

  return async function requireAuth(req, res, next) {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[cookieName];

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        });
      }

      const session = await sessionStore.get(token);
      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        });
      }

      req.user = session;
      return next();
    } catch (error) {
      console.error('Auth middleware error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  };
}

const requireAuth = createAuthMiddleware();
requireAuth.createAuthMiddleware = createAuthMiddleware;

module.exports = {
  requireAuth,
  createAuthMiddleware,
};
