const crypto = require('crypto');
const { logEvent } = require('../lib/logger');
const { redisClient } = require('../lib/redis');

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 3600;

function createResendLimiter(options = {}) {
  let clientOverride = options.redisClient;
  const limit = options.limit || DEFAULT_LIMIT;
  const windowSeconds = options.windowSeconds || DEFAULT_WINDOW_SECONDS;

  function getRedis() {
    if (clientOverride !== undefined) {
      return clientOverride;
    }
    return redisClient;
  }

  async function checkAndIncrement(email) {
    if (!email || typeof email !== 'string') {
      return { allowed: false, reason: 'invalid_email' };
    }

    const redis = getRedis();

    // Fail-closed nếu không có Redis client hoặc client không ở trạng thái mở
    if (!redis || redis.isOpen === false) {
      logEvent('resend_blocked', { reason: 'limiter_unavailable' });
      return { allowed: false, reason: 'limiter_unavailable' };
    }

    try {
      const emailHash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      const keyPrefix = process.env.REDIS_KEY_PREFIX || 'bvsk:';
      const rateLimitKey = `${keyPrefix}resend:${emailHash}`;

      if (typeof redis.multi !== 'function') {
        throw new Error('Redis client does not support multi');
      }

      const multi = redis.multi();
      multi.incr(rateLimitKey);
      multi.expire(rateLimitKey, windowSeconds, 'NX');
      const execResult = await multi.exec();

      if (!execResult || execResult[0] === undefined || execResult[0] === null) {
        throw new Error('Redis multi.exec returned invalid response');
      }

      const count = Number(execResult[0]);
      if (Number.isNaN(count)) {
        throw new Error('Redis count is NaN');
      }

      if (count > limit) {
        logEvent('resend_blocked', { reason: 'rate_limited' });
        return { allowed: false, reason: 'rate_limited', count };
      }

      return { allowed: true, count };
    } catch {
      // Fail-closed: mọi lỗi thao tác Redis (mất kết nối, timeout, client đã đóng...)
      // Tuyệt đối không đoán bộ đếm, chặn gửi và ghi log
      logEvent('resend_blocked', { reason: 'limiter_unavailable' });
      return { allowed: false, reason: 'limiter_unavailable' };
    }
  }

  return {
    checkAndIncrement,
    isAllowed: checkAndIncrement,
    setRedisClient(client) {
      clientOverride = client;
    },
    resetRedisClient() {
      clientOverride = undefined;
    },
  };
}

const defaultResendLimiter = createResendLimiter();
defaultResendLimiter.createResendLimiter = createResendLimiter;

module.exports = defaultResendLimiter;
