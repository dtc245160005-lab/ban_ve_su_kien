const crypto = require('crypto');
const defaultDb = require('../db');
const { logEvent } = require('../lib/logger');

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 giờ

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

function buildActivationUrl(rawToken) {
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:8090').replace(/\/$/, '');
  return `${baseUrl}/activate.html#token=${encodeURIComponent(rawToken)}`;
}

function createActivationService({ db = defaultDb } = {}) {
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
      const tokenObj = createActivationToken(now);
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
    hashToken,
    buildActivationUrl,
    activate,
    generateResendToken,
  };
}

const defaultActivationService = createActivationService();
defaultActivationService.createActivationService = createActivationService;
defaultActivationService.ACTIVATION_TTL_MS = ACTIVATION_TTL_MS;

module.exports = defaultActivationService;
