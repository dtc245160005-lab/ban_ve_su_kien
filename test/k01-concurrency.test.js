const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSpike } = require('../scripts/spike-seat-holds');

test('K-01: real Redis and PostgreSQL allow exactly one of 200 contenders per seat', { timeout: 30000 }, async () => {
  const result = await runSpike({ trials: 2 });
  for (const provider of ['redis', 'postgres']) {
    assert.equal(result[provider].length, 2);
    for (const trial of result[provider]) {
      assert.equal(trial.requests, 200);
      assert.equal(trial.successes, 1);
      assert.equal(trial.conflicts, 199);
      assert.equal(trial.errors, 0);
    }
  }
  assert.equal(result.scenarios.applicationReconnect, 'PASS');
  assert.equal(result.scenarios.expiryReclaim, 'PASS');
  assert.equal(result.scenarios.postgresCleanupIdempotent, 'PASS');
  assert.equal(result.scenarios.redisKeyLossAllowsNewOwner, true);
});
