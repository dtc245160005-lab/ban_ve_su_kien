const crypto = require('crypto');
const defaultDb = require('../db');
const { logEvent } = require('../lib/logger');

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 giờ
const OTP_TTL_MS = Number(process.env.ACTIVATION_CODE_TTL_SECONDS || 600) * 1000;
const OTP_MAX_ATTEMPTS = Number(process.env.ACTIVATION_CODE_MAX_ATTEMPTS || 5);

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function createActivationToken(now = new Date()) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);

  return {
    rawToken,
    tokenHash,
    expiresAt,
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashActivationCode(email, code) {
  return hashToken(`${normalizeEmail(email)}:${String(code || '').trim()}`);
}

function createActivationCode(email, now = new Date()) {
  const rawCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return {
    rawCode,
    rawToken: rawCode,
    tokenHash: hashActivationCode(email, rawCode),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  };
}

function buildActivationUrl(rawToken) {
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
  return `${baseUrl}/activate.html#token=${encodeURIComponent(rawToken)}`;
}

function createActivationService({ db = defaultDb } = {}) {
  async function activateCode(email, rawCode, now = new Date()) {
    const normalizedEmail = normalizeEmail(email);
    const code = String(rawCode || '').trim();

    if (!normalizedEmail || !/^\d{6}$/.test(code)) {
      return { status: 400, code: 'CODE_INVALID', message: 'Mã xác nhận không hợp lệ.' };
    }

    return await db.transaction(async (trx) => {
      const user = await trx('users').where({ email: normalizedEmail }).forUpdate().first('id', 'is_active');
      if (!user) {
        return { status: 400, code: 'CODE_INVALID', message: 'Mã xác nhận không hợp lệ.' };
      }
      if (user.is_active) {
        return { status: 409, code: 'ACCOUNT_ALREADY_ACTIVE', message: 'Tài khoản đã được xác nhận.' };
      }

      const latestToken = await trx('email_activation_tokens')
        .where({ user_id: user.id })
        .whereNull('used_at')
        .orderBy('created_at', 'desc')
        .forUpdate()
        .first();

      if (!latestToken) {
        return { status: 400, code: 'CODE_INVALID', message: 'Mã xác nhận không hợp lệ.' };
      }
      if (latestToken.locked_until && new Date(latestToken.locked_until).getTime() > now.getTime()) {
        return { status: 429, code: 'CODE_LOCKED', message: 'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.' };
      }
      if (new Date(latestToken.expires_at).getTime() <= now.getTime()) {
        return { status: 410, code: 'CODE_EXPIRED', message: 'Mã xác nhận đã hết hạn. Vui lòng yêu cầu mã mới.' };
      }

      const expectedHash = hashActivationCode(normalizedEmail, code);
      const matches = latestToken.token_hash.length === expectedHash.length &&
        crypto.timingSafeEqual(Buffer.from(latestToken.token_hash), Buffer.from(expectedHash));

      if (!matches) {
        const nextAttempts = Number(latestToken.failed_attempts || 0) + 1;
        const locked = nextAttempts >= OTP_MAX_ATTEMPTS;
        await trx('email_activation_tokens').where({ id: latestToken.id }).update({
          failed_attempts: nextAttempts,
          locked_until: locked ? latestToken.expires_at : null,
        });
        return {
          status: locked ? 429 : 400,
          code: locked ? 'CODE_LOCKED' : 'CODE_INVALID',
          message: locked
            ? 'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.'
            : 'Mã xác nhận không đúng.',
        };
      }

      const updated = await trx('email_activation_tokens')
        .where({ id: latestToken.id })
        .whereNull('used_at')
        .update({ used_at: now });
      if (updated !== 1) {
        return { status: 409, code: 'CODE_USED', message: 'Mã xác nhận đã được sử dụng.' };
      }

      await trx('users').where({ id: user.id }).update({ is_active: true, updated_at: now });
      return {
        status: 200,
        userId: user.id,
        code: 'ACCOUNT_ACTIVATED',
        message: 'Xác nhận tài khoản thành công. Bạn có thể đăng nhập.',
      };
    });
  }

  async function activate(rawToken, now = new Date()) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim() === '') {
      return {
        status: 400,
        code: 'TOKEN_INVALID',
        message: 'Mã kích hoạt không hợp lệ.',
      };
    }

    const tokenHash = hashToken(rawToken.trim());

    return await db.transaction(async (trx) => {
      // 1. Cập nhật used_at bằng một câu lệnh atomic duy nhất
      const updateResult = await trx.raw(
        `UPDATE email_activation_tokens
         SET used_at = ?
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
         RETURNING user_id;`,
        [now, tokenHash, now]
      );

      const rows = updateResult.rows || updateResult;
      if (rows && rows.length > 0) {
        const userId = rows[0].user_id;
        await trx('users').where({ id: userId }).update({
          is_active: true,
          updated_at: now,
        });

        return {
          status: 200,
          userId,
          code: 'ACCOUNT_ACTIVATED',
          message: 'Tài khoản đã được kích hoạt thành công.',
        };
      }

      // 2. Nếu không cập nhật được dòng nào, tra lại để phân biệt 3 trường hợp
      const tokenRecord = await trx('email_activation_tokens')
        .where({ token_hash: tokenHash })
        .first();

      if (!tokenRecord) {
        return {
          status: 400,
          code: 'TOKEN_INVALID',
          message: 'Mã kích hoạt không tồn tại hoặc không hợp lệ.',
        };
      }

      if (tokenRecord.used_at) {
        return {
          status: 409,
          code: 'TOKEN_USED',
          message: 'Liên kết đã được sử dụng.',
        };
      }

      if (new Date(tokenRecord.expires_at).getTime() <= now.getTime()) {
        return {
          status: 410,
          code: 'TOKEN_EXPIRED',
          message: 'Liên kết đã hết hạn.',
        };
      }

      return {
        status: 400,
        code: 'TOKEN_INVALID',
        message: 'Mã kích hoạt không hợp lệ.',
      };
    });
  }

  async function generateResendToken(email, now = new Date()) {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();

    return await db.transaction(async (trx) => {
      // Khoá dòng users của user đó bằng SELECT ... FOR UPDATE để serialize các request song song
      const user = await trx('users')
        .where({ email: normalizedEmail })
        .forUpdate()
        .first('id', 'email', 'full_name', 'is_active');

      if (!user || user.is_active) {
        return null;
      }

      // Chốt chặn DB: đếm số token của user đó có purpose='resend' và created_at > now() - interval '1 hour'
      const countResult = await trx('email_activation_tokens')
        .where({ user_id: user.id, purpose: 'resend' })
        .whereRaw("created_at > (now() - interval '1 hour')")
        .count('* as count')
        .first();

      const count = Number(countResult?.count || 0);
      if (count >= 5) {
        logEvent('resend_blocked', { userId: user.id, reason: 'db_rate_limited' });
        return null;
      }

      // Đánh dấu các token cũ còn hạn/chưa sử dụng là đã dùng
      await trx('email_activation_tokens')
        .where({ user_id: user.id })
        .whereNull('used_at')
        .update({ used_at: trx.fn.now() });

      // Tạo token mới với purpose='resend'
      const tokenObj = createActivationCode(user.email, now);
      await trx('email_activation_tokens').insert({
        user_id: user.id,
        purpose: 'resend',
        token_hash: tokenObj.tokenHash,
        expires_at: tokenObj.expiresAt,
      });

      return {
        user,
        tokenObj,
      };
    });
  }

  return {
    createActivationToken,
    createActivationCode,
    hashActivationCode,
    hashToken,
    buildActivationUrl,
    activate,
    activateCode,
    generateResendToken,
  };
}

const defaultActivationService = createActivationService();
defaultActivationService.createActivationService = createActivationService;
defaultActivationService.ACTIVATION_TTL_MS = ACTIVATION_TTL_MS;
defaultActivationService.OTP_TTL_MS = OTP_TTL_MS;
defaultActivationService.OTP_MAX_ATTEMPTS = OTP_MAX_ATTEMPTS;

module.exports = defaultActivationService;
