const crypto = require('crypto');
const express = require('express');
const argon2 = require('argon2');
const { redisClient } = require('../lib/redis');
const defaultDb = require('../db');
const { createUserRepository } = require('../services/userRepository');
const { createRedisAuthStore } = require('../services/redisAuthStore');
const { createAuthService } = require('../services/authService');
const defaultActivationService = require('../services/activationService');
const defaultEmailService = require('../services/emailService');
const { validateRegisterForm } = require('../public/registerForm');
const { secure } = require('../middleware/routeRegistry');
const { logEvent } = require('../lib/logger');
const { createAuthenticateMiddleware, getSessionToken } = require('../middleware/authenticate');

const GENERIC_REGISTER_MESSAGE =
  'Nếu email hợp lệ, bạn sẽ nhận được hướng dẫn trong hộp thư.';
const GENERIC_RESEND_MESSAGE =
  'Nếu email hợp lệ và chưa kích hoạt, bạn sẽ nhận được hướng dẫn trong hộp thư.';

function createAuthRouter(customDependencies = {}) {
  const router = express.Router();
  const db = customDependencies.db || defaultDb;
  const redis = customDependencies.redisClient || redisClient;

  const cookieName =
    customDependencies.cookieName || process.env.SESSION_COOKIE_NAME || 'session_token';

  const userRepo =
    customDependencies.userRepository ||
    createUserRepository(db);

  const authStore =
    customDependencies.authStore ||
    createRedisAuthStore(redis, {
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

  const activationService =
    customDependencies.activationService ||
    defaultActivationService.createActivationService({ db });

  const emailService =
    customDependencies.emailService ||
    defaultEmailService;

  const authenticateMiddleware =
    customDependencies.authenticateMiddleware ||
    createAuthenticateMiddleware(sessionStore);

  // 1. POST /api/auth/login
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

  // 2. GET /api/auth/session
  secure(router, 'get', '/session', 'public', authenticateMiddleware, async (req, res) => {
    return res.json({ success: true, user: req.session || req.user });
  });

  // 3. POST /api/auth/logout
  secure(router, 'post', '/logout', 'public', async (req, res) => {
    try {
      const token = getSessionToken(req, cookieName);

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

  // 4. POST /api/auth/register
  secure(router, 'post', '/register', 'public', async (req, res) => {
    try {
      const validation = validateRegisterForm(req.body || {});
      if (!validation.valid) {
        return res.status(400).json({ errors: validation.errors });
      }

      const email = String(req.body.email).trim().toLowerCase();
      const fullName = String(req.body.full_name).trim();
      const password = req.body.password;

      // Kiểm tra email đã tồn tại hay chưa
      const existingUser = await db('users').where({ email }).first('id');
      if (existingUser) {
        // Vẫn hash password để thời gian phản hồi tương đương, chống timing attack
        await argon2.hash(password, { type: argon2.argon2id });
        logEvent('register_requested', { req, status: 202 });
        return res.status(202).json({
          success: true,
          message: GENERIC_REGISTER_MESSAGE,
        });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const tokenObj = activationService.createActivationToken();

      let createdUser = null;
      try {
        await db.transaction(async (trx) => {
          const [user] = await trx('users')
            .insert({
              email,
              full_name: fullName,
              password_hash: passwordHash,
              is_active: false,
            })
            .returning(['id', 'email']);

          const buyerRole = await trx('roles').where({ name: 'buyer' }).first('id');
          if (!buyerRole) {
            throw new Error('Vai trò buyer chưa được khởi tạo trong hệ thống.');
          }

          await trx('user_roles').insert({
            user_id: user.id,
            role_id: buyerRole.id,
          });

          await trx('email_activation_tokens').insert({
            user_id: user.id,
            token_hash: tokenObj.tokenHash,
            expires_at: tokenObj.expiresAt,
          });

          createdUser = user;
        });
      } catch (dbErr) {
        // Xử lý race condition: 2 request song song cùng email mới
        if (
          dbErr.code === '23505' ||
          dbErr.message?.includes('unique') ||
          dbErr.message?.includes('duplicate')
        ) {
          logEvent('register_requested', { req, status: 202 });
          return res.status(202).json({
            success: true,
            message: GENERIC_REGISTER_MESSAGE,
          });
        }
        throw dbErr;
      }

      // Chỉ gửi email sau khi transaction đã commit thành công
      try {
        const activationUrl = activationService.buildActivationUrl(tokenObj.rawToken);
        await emailService.sendActivationEmail({
          to: createdUser.email,
          fullName,
          activationUrl,
        });
      } catch {
        logEvent('mail_failed', { userId: createdUser.id, status: 500 });
      }

      logEvent('register_requested', { userId: createdUser.id, req, status: 202 });
      return res.status(202).json({
        success: true,
        message: GENERIC_REGISTER_MESSAGE,
      });
    } catch (error) {
      console.error('Register error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  });

  // 5. POST /api/auth/activate
  secure(router, 'post', '/activate', 'public', async (req, res) => {
    try {
      const token = req.body?.token;
      const result = await activationService.activate(token);

      if (result.status === 200) {
        logEvent('activation_succeeded', { userId: result.userId, req, status: 200 });
      } else {
        logEvent('activation_failed', { req, status: result.status });
      }

      return res.status(result.status).json({
        success: result.status === 200,
        code: result.code,
        message: result.message,
      });
    } catch (error) {
      console.error('Activation error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Hệ thống đang bận. Vui lòng thử lại sau.',
      });
    }
  });

  // 6. POST /api/auth/resend-activation
  secure(router, 'post', '/resend-activation', 'public', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();

      // Giới hạn 5 lần / giờ cho mỗi email bằng Redis
      const emailHash = crypto.createHash('sha256').update(email).digest('hex');
      const keyPrefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
      const rateLimitKey = `${keyPrefix}resend:${emailHash}`;

      let attemptsCount = 1;
      if (redis && redis.isOpen) {
        const multi = redis.multi();
        multi.incr(rateLimitKey);
        multi.expire(rateLimitKey, 3600, 'NX');
        const execResult = await multi.exec();
        attemptsCount = Number(execResult[0]);
      }

      if (attemptsCount <= 5 && email) {
        const user = await db('users')
          .where({ email })
          .first('id', 'email', 'full_name', 'is_active');

        if (user && !user.is_active) {
          const tokenObj = activationService.createActivationToken();

          await db.transaction(async (trx) => {
            // Đánh dấu mọi token cũ còn hạn là đã sử dụng
            await trx('email_activation_tokens')
              .where({ user_id: user.id })
              .whereNull('used_at')
              .update({ used_at: trx.fn.now() });

            // Chèn token mới
            await trx('email_activation_tokens').insert({
              user_id: user.id,
              token_hash: tokenObj.tokenHash,
              expires_at: tokenObj.expiresAt,
            });
          });

          try {
            const activationUrl = activationService.buildActivationUrl(tokenObj.rawToken);
            await emailService.sendActivationEmail({
              to: user.email,
              fullName: user.full_name,
              activationUrl,
            });
          } catch {
            logEvent('mail_failed', { userId: user.id, status: 500 });
          }
        }
      }

      logEvent('resend_requested', { req, status: 202 });
      return res.status(202).json({
        success: true,
        message: GENERIC_RESEND_MESSAGE,
      });
    } catch (error) {
      console.error('Resend activation error:', error.message);
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
