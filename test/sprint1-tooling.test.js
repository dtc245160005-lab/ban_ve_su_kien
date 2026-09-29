const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment, compareMigrations } = require('../scripts/doctor');
const { setup } = require('../scripts/setup');
const { checkStaging } = require('../scripts/check-staging');
const { race } = require('../scripts/spike-seat-holds');

const configured = { DB_CONNECTION_STRING: 'postgresql://localhost/test',
  DEMO_ADMIN_EMAIL: 'a@example.test', DEMO_ADMIN_PASSWORD: 'test-fixture',
  DEMO_ORGANIZER_EMAIL: 'o@example.test', DEMO_ORGANIZER_PASSWORD: 'test-fixture' };
test('Doctor reports configuration names, never secret-bearing values', () => {
  assert.deepEqual(validateEnvironment(configured, '20.19.0'), []);
  assert.ok(validateEnvironment(configured, '20.18.0').length);
  const errors = validateEnvironment({ ...configured, DB_CONNECTION_STRING: 'secret-value' }, '18.0.0');
  assert.equal(errors.length, 2);
  assert.ok(!errors.join(' ').includes('secret-value'));
  assert.ok(validateEnvironment({ ...configured, NODE_ENV: 'staging' }).length);
  assert.ok(validateEnvironment({ ...configured, MAIL_TRANSPORT: 'smtp' }).length);
  assert.ok(validateEnvironment({ ...configured, MAIL_TRANSPORT: 'unknown' }).length);
});
test('Doctor distinguishes pending migrations from foreign migration history', () => {
  assert.deepEqual(compareMigrations(['old.js'], ['new.js']), { orphaned: ['old.js'], pending: ['new.js'] });
});
test('Knex CLI supports the staging environment without changing database configuration', () => {
  const config = require('../knexfile');
  assert.equal(config.staging, config.production);
});
test('Setup does not migrate or seed when preflight detects an incompatible database', async () => {
  let ran = false;
  await assert.rejects(setup({ inspect: async () => ({ errors: ['foreign migration'] }),
    run: () => { ran = true; } }), /foreign migration/);
  assert.equal(ran, false);
});
test('Setup stops before seed when migrations fail', async () => {
  const commands = [];
  await assert.rejects(setup({ inspect: async () => ({ errors: [] }), run: (_cmd, args) => {
    commands.push(args.at(-1)); return { status: 1 };
  } }), /migrate:latest/);
  assert.deepEqual(commands, ['migrate:latest']);
});
test('Staging probe checks readiness and exact deployed revision', async () => {
  const sha = 'a'.repeat(40);
  const fetchImpl = async () => ({ status: 200, json: async () => ({ status: 'ok', revision: sha }) });
  const result = await checkStaging({ url: 'https://staging.example.test', expectedRevision: sha, fetchImpl });
  assert.equal(result.expectedRevisionVerified, true);
  const legacy = await checkStaging({ url: 'https://staging.example.test',
    fetchImpl: async () => ({ status: 200, json: async () => ({ status: 'ok' }) }) });
  assert.equal(legacy.revision, null);
  assert.equal(legacy.expectedRevisionVerified, false);
  await assert.rejects(checkStaging({ url: 'https://staging.example.test', expectedRevision: 'b'.repeat(40), fetchImpl }), /commit khác/);
  await assert.rejects(checkStaging({ url: 'https://user:secret@staging.example.test', fetchImpl }), /credentials/);
  await assert.rejects(checkStaging({ url: 'https://staging.example.test', fetchImpl: async () => ({ status: 503, json: async () => ({ status: 'error' }) }) }), /readiness/);
});
test('K-01 harness rejects a double winner and submits all 200 contenders', async () => {
  let count = 0;
  const result = await race(async () => ++count === 1);
  assert.equal(count, 200);
  assert.equal(result.successes, 1);
  await assert.rejects(race(async () => true), /exactly one winner/);
});
