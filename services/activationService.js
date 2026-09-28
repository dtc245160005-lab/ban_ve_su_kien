const crypto = require('crypto');
const defaultDb = require('../db');

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

  return {
    createActivationToken,
    hashToken,
    buildActivationUrl,
    activate,
  };
}

const defaultActivationService = createActivationService();
defaultActivationService.createActivationService = createActivationService;
defaultActivationService.ACTIVATION_TTL_MS = ACTIVATION_TTL_MS;

module.exports = defaultActivationService;
