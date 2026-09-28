const express = require('express');
const { parseCookies } = require('../lib/cookies');
const { redisClient } = require('../lib/redis');
const db = require('../db');
const { createUserRepository } = require('../services/userRepository');
const { createRedisAuthStore } = require('../services/redisAuthStore');
const { createAuthService } = require('../services/authService');
const { secure } = require('../middleware/routeRegistry');

function createAuthRouter(customDependencies = {}) {
  const router = express.Router();

  const cookieName =
    customDependencies.cookieName || process.env.SESSION_COOKIE_NAME || 'session_token';

  const userRepo =
    customDependencies.userRepository ||
    createUserRepository(customDependencies.db || db);

  const authStore =
    customDependencies.authStore ||
    createRedisAuthStore(customDependencies.redisClient || redisClient, {
      maxFailedAttempts: process.env.LOGIN_MAX_FAILED_ATTEMPTS,
      maxIpFailedAttempts: process.env.LOGIN_MAX_IP_FAILED_ATTEMPTS,
      lockSeconds: process.env.LOGIN_LOCK_SECONDS,
      sessionTtlSeconds: process.env.SESSION_TTL_SECONDS,
    });

  const sessionStore = customDependencies.sessionStore || authStore.sessionStore;
  const attemptStore = customDependencies.attemptStore || authStore.attemptStore;

  const authService =
    customDependencies.authService ||
    createAuthService({
      userRepository: userRepo,
      attemptStore,
      sessionStore,
    });

  secure(router, 'post', '/login', 'public', async (req, res) => {
    try {
      const clientIp = req.ip || '127.0.0.1';

      const result = await authService.login({
        email: req.body?.email,
        password: req.body?.password,
        ip: clientIp,
      });

      if (result.status === 429 && result.body.retryAfterSeconds) {
        res.set('Retry-After', String(result.body.retryAfterSeconds));
      }

      if (result.session) {
        res.cookie(cookieName, result.session.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: result.session.ttlSeconds * 1000,
          path: '/',
        });
      }

      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Login error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  });

  secure(router, 'get', '/session', 'public', async (req, res) => {
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

      return res.json({ success: true, user: session });
    } catch (error) {
      console.error('Session error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  });

  secure(router, 'post', '/logout', 'public', async (req, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[cookieName];

      if (token) {
        await sessionStore.remove(token);
      }

      res.clearCookie(cookieName, { path: '/' });
      return res.json({ success: true, message: 'Đã đăng xuất.' });
    } catch (error) {
      console.error('Logout error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  });

  return router;
}

const defaultRouter = createAuthRouter();
defaultRouter.createAuthRouter = createAuthRouter;

module.exports = defaultRouter;
