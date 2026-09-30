const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectEnvironment } = require('./doctor');

async function setup({ root = path.resolve(__dirname, '..'), env = process.env,
  inspect = inspectEnvironment, run = spawnSync } = {}) {
  const state = await inspect({ root, env });
  if (state.errors.length) {
    const onlyDbMissing = state.errors.every((err) => err.includes('3D000') || err.includes('chưa tồn tại'));
    if (onlyDbMissing) {
      const { createDatabase } = require('./create-db');
      await createDatabase({ connectionString: env.DB_CONNECTION_STRING });
      const recheck = await inspect({ root, env });
      if (recheck.errors.length) throw new Error(recheck.errors.join('\n'));
    } else {
      throw new Error(state.errors.join('\n'));
    }
  }
  for (const command of ['migrate:latest', 'seed:run']) {
    console.log(`[SETUP] ${command}`);
    const result = run(process.execPath, [path.join(root, 'node_modules/knex/bin/cli.js'), command],
      { cwd: root, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`SETUP: FAIL ${command}`);
  }
  console.log('SETUP: PASS');
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  setup().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { setup };
