const defaultDb = require('../db');
const { logEvent } = require('../lib/logger');

const DEFAULT_INTERVAL_MS = 60_000;

function createExpiredSeatHoldsJob(options = {}) {
  const db = options.db || defaultDb;
  const logger = options.logger || logEvent;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  const sweep = options.sweep || (async () => db('seat_holds')
    .whereNull('order_id')
    .where('expires_at', '<=', db.fn.now())
    .del());

  let activeRun = null;
  let timer = null;

  function runOnce() {
    if (activeRun) return activeRun;

    activeRun = Promise.resolve()
      .then(sweep)
      .then((deleted) => {
        const count = Number(deleted) || 0;
        logger('expired_seat_holds_cleaned', { count, status: 'completed' });
        return count;
      })
      .catch((error) => {
        logger('expired_seat_holds_cleanup_failed', {
          status: 'failed',
          reason: 'database_error',
        });
        throw error;
      })
      .finally(() => {
        activeRun = null;
      });

    return activeRun;
  }

  async function start({ runImmediately = true } = {}) {
    if (timer) return;
    if (runImmediately) await runOnce();

    timer = setIntervalFn(() => {
      runOnce().catch(() => {
        // Lỗi đã được ghi log trong runOnce; giữ scheduler tiếp tục chạy.
      });
    }, intervalMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return {
    runOnce,
    start,
    stop,
    get running() {
      return Boolean(activeRun);
    },
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  createExpiredSeatHoldsJob,
};
