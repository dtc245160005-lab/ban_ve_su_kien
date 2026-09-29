const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config();

function parseFailedTests(output) {
  const lines = output.split(/\r?\n/);
  const failed = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tapMatch = line.match(/^\s*not ok\s+\d*\s*-?\s*(.*)$/);
    if (tapMatch) {
      if (current) failed.push(current);
      current = { name: tapMatch[1].trim() || 'Unnamed test', error: '' };
      continue;
    }

    const specMatch = line.match(/^\s*[✖✕]\s+(.*)$/);
    if (specMatch) {
      if (current) failed.push(current);
      current = { name: specMatch[1].trim() || 'Unnamed test', error: '' };
      continue;
    }

    if (current && !current.error) {
      const errPropMatch = line.match(/^\s*error:\s*['"]?(.*?)['"]?$/);
      if (errPropMatch && errPropMatch[1] !== 'test failed') {
        current.error = errPropMatch[1].trim();
      } else {
        const errorLineMatch = line.match(/^\s*(?:[A-Z][a-zA-Z]*Error|TypeError|Error):\s*(.*)$/);
        if (errorLineMatch) {
          current.error = line.trim();
        }
      }
    }
  }

  if (current) failed.push(current);
  const specificTests = failed.filter((f) => !f.error.includes('subtests failed'));
  return specificTests.length > 0 ? specificTests : failed;
}

function runCommand(command, args, env) {
  const isWindows = process.platform === 'win32';
  let resolvedCommand = command;
  let resolvedArgs = args;

  if (command === 'npm' && isWindows) {
    resolvedCommand = 'cmd.exe';
    resolvedArgs = ['/d', '/s', '/c', 'npm', ...args];
  }

  const result = spawnSync(resolvedCommand, resolvedArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
    cwd: path.resolve(__dirname, '..'),
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}`);
  }
}

function runNpmTest(env, onFailed) {
  const isWindows = process.platform === 'win32';
  let resolvedCommand = 'npm';
  let resolvedArgs = ['test'];

  if (isWindows) {
    resolvedCommand = 'cmd.exe';
    resolvedArgs = ['/d', '/s', '/c', 'npm', 'test'];
  }

  const result = spawnSync(resolvedCommand, resolvedArgs, {
    env: {
      ...process.env,
      ...env,
    },
    cwd: path.resolve(__dirname, '..'),
    shell: false,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    const failedTests = parseFailedTests(combined);
    if (typeof onFailed === 'function') {
      onFailed(failedTests);
    }
    throw new Error(`Command failed with exit code ${result.status}`);
  }
}

async function getAdminClient(primaryUrl, fallbackUrl) {
  let client = new Client({ connectionString: primaryUrl });
  try {
    await client.connect();
    return client;
  } catch (err) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      client = new Client({ connectionString: fallbackUrl });
      await client.connect();
      return client;
    }
    throw err;
  }
}

async function main() {
  const baseConnectionString = process.env.DB_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5432/postgres';
  const timestamp = Date.now();
  const tempDbName = `ban_ve_verify_${timestamp}`;

  const tempDbUrl = new URL(baseConnectionString);
  tempDbUrl.pathname = `/${tempDbName}`;
  const tempDbConnectionString = tempDbUrl.toString();

  const adminUrl = new URL(baseConnectionString);
  if (!adminUrl.pathname || adminUrl.pathname === '/' || adminUrl.pathname === `/${tempDbName}`) {
    adminUrl.pathname = '/postgres';
  }

  const verifyEnv = {
    ...process.env,
    DB_CONNECTION_STRING: tempDbConnectionString,
    REDIS_KEY_PREFIX: `bvsk-verify:${timestamp}:`,
    NODE_ENV: 'test',
    MAIL_TRANSPORT: 'dev',
    DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL || 'admin@example.com',
    DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin@123456',
    DEMO_ORGANIZER_EMAIL: process.env.DEMO_ORGANIZER_EMAIL || 'organizer@example.com',
    DEMO_ORGANIZER_PASSWORD: process.env.DEMO_ORGANIZER_PASSWORD || 'DemoOrganizer@123456',
  };

  const knexCliPath = path.resolve(__dirname, '../node_modules/knex/bin/cli.js');

  let adminClient = null;
  let tempDbCreated = false;
  let failedStep = null;
  let failedTestsList = null;

  try {
    // 1. Create temporary database
    try {
      console.log(`\n[VERIFY STEP] Creating temporary database: ${tempDbName}`);
      adminClient = await getAdminClient(adminUrl.toString(), baseConnectionString);
      await adminClient.query(`CREATE DATABASE "${tempDbName}"`);
      tempDbCreated = true;
      console.log(`[VERIFY STEP] Temporary database created successfully.`);
    } catch (err) {
      console.error(`Error creating database: ${err.message}`);
      failedStep = 'create_temp_db';
      throw err;
    }

    // 2. migrate:latest
    try {
      console.log('\n[VERIFY STEP] Running migrate:latest (1/2)');
      runCommand(process.execPath, [knexCliPath, 'migrate:latest'], verifyEnv);
    } catch (err) {
      failedStep = 'migrate:latest';
      throw err;
    }

    // 3. migrate:rollback --all
    try {
      console.log('\n[VERIFY STEP] Running migrate:rollback --all');
      runCommand(process.execPath, [knexCliPath, 'migrate:rollback', '--all'], verifyEnv);
    } catch (err) {
      failedStep = 'migrate:rollback --all';
      throw err;
    }

    // 4. migrate:latest (again)
    try {
      console.log('\n[VERIFY STEP] Running migrate:latest (2/2)');
      runCommand(process.execPath, [knexCliPath, 'migrate:latest'], verifyEnv);
    } catch (err) {
      failedStep = 'migrate:latest';
      throw err;
    }

    // 5. seed:run
    try {
      console.log('\n[VERIFY STEP] Running seed:run');
      runCommand(process.execPath, [knexCliPath, 'seed:run'], verifyEnv);
    } catch (err) {
      failedStep = 'seed:run';
      throw err;
    }

    // 6. npm run lint
    try {
      console.log('\n[VERIFY STEP] Running npm run lint');
      runCommand('npm', ['run', 'lint'], verifyEnv);
    } catch (err) {
      failedStep = 'npm run lint';
      throw err;
    }

    // 7. npm test
    try {
      console.log('\n[VERIFY STEP] Running npm test');
      runNpmTest(verifyEnv, (failed) => {
        failedTestsList = failed;
      });
    } catch (err) {
      failedStep = 'npm test';
      throw err;
    }
  } catch {
    // Errors handled through failedStep
  } finally {
    if (tempDbCreated && adminClient) {
      try {
        console.log(`\n[VERIFY STEP] Cleaning up temporary database: ${tempDbName}`);
        await adminClient.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid();
        `, [tempDbName]);
        await adminClient.query(`DROP DATABASE IF EXISTS "${tempDbName}" WITH (FORCE);`);
        console.log(`[VERIFY STEP] Temporary database dropped successfully.`);
      } catch (cleanupErr) {
        console.error(`Warning: Failed to drop database ${tempDbName}: ${cleanupErr.message}`);
      }
    }
    if (adminClient) {
      await adminClient.end().catch(() => {});
    }

    try {
      const { createClient } = require('redis');
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const cleanupRedis = createClient({ url: redisUrl });
      await cleanupRedis.connect();
      const verifyPrefix = `bvsk-verify:${timestamp}:`;
      let cursor = 0;
      do {
        const reply = await cleanupRedis.scan(cursor, { MATCH: `${verifyPrefix}*`, COUNT: 100 });
        cursor = reply.cursor;
        if (reply.keys.length > 0) {
          await cleanupRedis.del(reply.keys);
        }
      } while (cursor !== 0);
      await cleanupRedis.quit();
    } catch {
      // Bỏ qua lỗi cleanup redis nếu có
    }
  }

  if (failedStep) {
    if (failedStep === 'npm test' && failedTestsList && failedTestsList.length > 0) {
      console.log('\n==============================');
      console.log('FAILED TESTS:');
      for (const ft of failedTestsList) {
        console.log(`- ${ft.name}${ft.error ? ': ' + ft.error : ''}`);
      }
      console.log('==============================\n');
    }
    console.log(`VERIFY: FAIL ${failedStep}`);
    process.exit(1);
  } else {
    console.log('VERIFY: PASS');
    process.exit(0);
  }
}

main();
