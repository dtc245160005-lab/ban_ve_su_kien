const { parseCookies } = require('../lib/cookies');
const { redisClient } = require('../lib/redis');
const { createRedisAuthStore } = require('../services/redisAuthStore');

function createAuthenticateMiddleware(customSessionStore) {
  return async function authenticate(req, res, next) {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || 'session_token';
      const cookies = parseCookies(req.headers?.cookie);
      const token = cookies[cookieName];

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        });
      }

      const store =
        customSessionStore ||
        (req.app?.locals?.sessionStore) ||
        createRedisAuthStore(redisClient).sessionStore;

      const session = await store.get(token);

      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        });
      }

      req.user = {
        id: session.userId,
        roles: Array.isArray(session.roles) ? session.roles : [],
      };

      return next();
    } catch (err) {
      console.error('Authentication error:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  };
}

const defaultAuthenticate = createAuthenticateMiddleware();

module.exports = defaultAuthenticate;
module.exports.authenticate = defaultAuthenticate;
module.exports.createAuthenticateMiddleware = createAuthenticateMiddleware;
