const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_INTERVAL_MS,
  createExpiredSeatHoldsJob,
} = require('../jobs/expiredSeatHolds');

describe('T-27 expired seat holds scheduler', () => {
  test('chạy ngay khi khởi động, lặp lại mỗi 60 giây và dừng sạch', async () => {
    let callback;
    let configuredDelay;
    let clearedTimer;
    let sweepCount = 0;
    const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
    const logs = [];

    const job = createExpiredSeatHoldsJob({
      sweep: async () => {
        sweepCount += 1;
        return sweepCount;
      },
      logger: (event, payload) => logs.push({ event, ...payload }),
      setIntervalFn: (handler, delay) => {
        callback = handler;
        configuredDelay = delay;
        return timer;
      },
      clearIntervalFn: (value) => { clearedTimer = value; },
    });

    await job.start();

    assert.equal(DEFAULT_INTERVAL_MS, 60_000);
    assert.equal(configuredDelay, 60_000);
    assert.equal(sweepCount, 1, 'startup phải dọn backlog trước khi nhận request');
    assert.equal(timer.unrefCalled, true);

    callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sweepCount, 2);
    assert.deepEqual(logs.map(({ count }) => count), [1, 2]);

    job.stop();
    assert.equal(clearedTimer, timer);
  });

  test('nhiều lần kích hoạt đồng thời chỉ dùng một lượt quét', async () => {
    let resolveSweep;
    let sweepCount = 0;
    const sweepGate = new Promise((resolve) => { resolveSweep = resolve; });
    const logs = [];
    const job = createExpiredSeatHoldsJob({
      sweep: async () => {
        sweepCount += 1;
        await sweepGate;
        return 12;
      },
      logger: (event, payload) => logs.push({ event, ...payload }),
    });

    const runs = Array.from({ length: 25 }, () => job.runOnce());
    resolveSweep();
    const results = await Promise.all(runs);

    assert.equal(sweepCount, 1);
    assert.deepEqual(results, Array(25).fill(12));
    assert.deepEqual(logs, [{
      event: 'expired_seat_holds_cleaned',
      count: 12,
      status: 'completed',
    }]);
  });
});
