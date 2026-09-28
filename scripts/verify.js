const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config();

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
    DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL || 'admin@example.com',
    DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin@123456',
    DEMO_ORGANIZER_EMAIL: process.env.DEMO_ORGANIZER_EMAIL || 'organizer@example.com',
    DEMO_ORGANIZER_PASSWORD: process.env.DEMO_ORGANIZER_PASSWORD || 'DemoOrganizer@123456',
  };

  const knexCliPath = path.resolve(__dirname, '../node_modules/knex/bin/cli.js');

  let adminClient = null;
  let tempDbCreated = false;
  let failedStep = null;

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
      runCommand('npm', ['test'], verifyEnv);
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
  }

  if (failedStep) {
    console.log(`VERIFY: FAIL ${failedStep}`);
    process.exit(1);
  } else {
    console.log('VERIFY: PASS');
    process.exit(0);
  }
}

main();
