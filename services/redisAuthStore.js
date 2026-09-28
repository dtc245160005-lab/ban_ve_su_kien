const crypto = require('crypto');

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRedisAuthStore(redisClient, options = {}) {
  const maxFailedAttempts = toPositiveInteger(
    options.maxFailedAttempts || process.env.LOGIN_MAX_FAILED_ATTEMPTS,
    5,
  );
  const maxIpFailedAttempts = toPositiveInteger(
    options.maxIpFailedAttempts || process.env.LOGIN_MAX_IP_FAILED_ATTEMPTS,
    20,
  );
  const lockSeconds = toPositiveInteger(
    options.lockSeconds || process.env.LOGIN_LOCK_SECONDS,
    15 * 60,
  );
  const sessionTtlSeconds = toPositiveInteger(
    options.sessionTtlSeconds || process.env.SESSION_TTL_SECONDS,
    8 * 60 * 60,
  );

  const failedKey = (key) => `auth:failed:${key}`;
  const lockKey = (key) => `auth:locked:${key}`;
  const sessionKey = (token) => `auth:session:${token}`;

  const attemptStore = {
    async getRemainingLockSeconds(key) {
      if (!key) return 0;
      const ttl = await redisClient.ttl(lockKey(key));
      return ttl > 0 ? ttl : 0;
    },

    async recordFailure(key, maxAttempts = maxFailedAttempts, duration = lockSeconds) {
      if (!key) return 0;
      const redisKey = failedKey(key);
      const failures = await redisClient.incr(redisKey);

      if (failures === 1) {
        await redisClient.expire(redisKey, duration);
      }

      if (failures >= maxAttempts) {
        await redisClient.set(lockKey(key), '1', { EX: duration });
        await redisClient.del(redisKey);
      }

      return failures;
    },

    async clear(key) {
      if (!key) return;
      await redisClient.del([failedKey(key), lockKey(key)]);
    },
  };

  const sessionStore = {
    async create(data) {
      const token = crypto.randomBytes(32).toString('hex');
      await redisClient.set(sessionKey(token), JSON.stringify(data), {
        EX: sessionTtlSeconds,
      });
      return { token, ttlSeconds: sessionTtlSeconds };
    },

    async get(token) {
      if (!token) return null;
      const raw = await redisClient.get(sessionKey(token));
      if (!raw) return null;

      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    async remove(token) {
      if (token) await redisClient.del(sessionKey(token));
    },
  };

  return {
    attemptStore,
    sessionStore,
    maxFailedAttempts,
    maxIpFailedAttempts,
    lockSeconds,
    sessionTtlSeconds,
  };
}

module.exports = { createRedisAuthStore, toPositiveInteger };
