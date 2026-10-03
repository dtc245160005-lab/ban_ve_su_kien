const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { createClient } = require('redis');

function validateEnvironment(env, nodeVersion = process.versions.node) {
  const errors = [];
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!(major >= 24 || (major === 22 && minor >= 13) || (major === 20 && minor >= 19))) {
    errors.push('Yêu cầu Node.js 20.19+, 22.13+ hoặc >=24 (phù hợp ESLint).');
  }
  for (const key of ['DB_CONNECTION_STRING', 'DEMO_ADMIN_EMAIL', 'DEMO_ADMIN_PASSWORD',
    'DEMO_ORGANIZER_EMAIL', 'DEMO_ORGANIZER_PASSWORD']) {
    if (!env[key]?.trim()) errors.push(`Thiếu biến ${key}.`);
  }
  for (const [key, protocols] of [['DB_CONNECTION_STRING', ['postgres:', 'postgresql:']],
    ['REDIS_URL', ['redis:', 'rediss:']]]) {
    if (!env[key]) continue;
    try {
      if (!protocols.includes(new URL(env[key]).protocol)) errors.push(`Sai giao thức ${key}.`);
    } catch { errors.push(`Sai định dạng ${key}.`); }
  }
  const mailTransport = env.MAIL_TRANSPORT || 'dev';
  if (!['dev', 'smtp'].includes(mailTransport)) errors.push('MAIL_TRANSPORT phải là dev hoặc smtp.');
  if (mailTransport === 'smtp') {
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
      if (!env[key]?.trim()) errors.push(`Thiếu biến ${key}.`);
    }
  } else if (!['development', 'test', undefined, ''].includes(env.NODE_ENV)) {
    errors.push('Staging/production yêu cầu MAIL_TRANSPORT=smtp.');
  }
  return errors;
}

function compareMigrations(recorded, available) {
  return {
    orphaned: recorded.filter((name) => !available.includes(name)),
    pending: available.filter((name) => !recorded.includes(name)),
  };
}

async function inspectEnvironment({ env = process.env, root = path.resolve(__dirname, '..'),
  requireConfiguredDatabase = false } = {}) {
  const errors = validateEnvironment(env);
  if (errors.length) return { errors, pending: [], schemaItems: [] };
  const pg = new Client({ connectionString: env.DB_CONNECTION_STRING, connectionTimeoutMillis: 5000 });
  const redis = createClient({ url: env.REDIS_URL || 'redis://localhost:6379',
    socket: { connectTimeout: 5000, reconnectStrategy: false } });
  redis.on('error', () => {});
  let pending = [];
  let schemaItems = [];
  try {
    await pg.connect();
    await pg.query('SELECT 1');
    const version = (await pg.query('SHOW server_version_num')).rows[0].server_version_num;
    if (Number(version) < 150000) errors.push('Yêu cầu PostgreSQL >= 15.');
    const exists = await pg.query("SELECT to_regclass('public.knex_migrations') AS name");
    const recorded = exists.rows[0].name
      ? (await pg.query('SELECT name FROM knex_migrations')).rows.map((row) => row.name) : [];
    const available = fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.js'));
    const state = compareMigrations(recorded, available);
    pending = state.pending;
    if (state.orphaned.length) {
      errors.push(`Database có migration từ nhánh khác: ${state.orphaned.join(', ')}. Dùng database mới hoặc đối chiếu nhánh; không tự xóa dữ liệu.`);
    }
    if (requireConfiguredDatabase && pending.length) errors.push('Database chưa migrate đầy đủ.');

    // Kiểm tra cấu trúc schema và vai trò khi DB đã chạy migration hoặc khi yêu cầu DB sẵn sàng
    if (recorded.length > 0 || requireConfiguredDatabase) {
      const { checkSchema } = require('../services/schemaCheck');
      const schemaResult = await checkSchema(pg);
      schemaItems = schemaResult.items;
      if (!schemaResult.ok && requireConfiguredDatabase) {
        for (const item of schemaItems.filter((i) => i.status !== 'OK')) {
          errors.push(`${item.description}${item.hint ? ` (${item.hint})` : ''}`);
        }
      }
    }
  } catch (error) {
    if (error.code === '28P01' || error.code === '28000') {
      errors.push('Sai thông tin xác thực PostgreSQL (mã 28P01). Vui lòng cập nhật mật khẩu PostgreSQL thực tế của bạn trong file .env (biến DB_CONNECTION_STRING).');
    } else if (error.code === '3D000') {
      errors.push('Database chưa tồn tại (mã 3D000). Chạy "npm run db:create" để tự động tạo database ứng dụng.');
    } else if (error.code === 'ECONNREFUSED') {
      errors.push('Không thể kết nối đến máy chủ PostgreSQL (ECONNREFUSED). Hãy đảm bảo dịch vụ PostgreSQL đang chạy và đúng cổng.');
    } else if (error.code === 'ENOTFOUND') {
      errors.push('Không tìm thấy máy chủ PostgreSQL (ENOTFOUND). Kiểm tra host trong DB_CONNECTION_STRING.');
    } else {
      errors.push(`Không kết nối/kiểm tra được PostgreSQL (${error.code || error.message}). Kiểm tra DB_CONNECTION_STRING và dịch vụ DB.`);
    }
  }
  finally { await pg.end().catch(() => {}); }
  try {
    await redis.connect();
    if (await redis.ping() !== 'PONG') errors.push('Redis không trả PONG.');
    const version = (await redis.info('server')).match(/redis_version:([^\r\n]+)/)?.[1];
    if (!version || Number(version.split('.')[0]) < 7) {
      errors.push('Yêu cầu Redis >= 7: đăng nhập/gửi lại email dùng EXPIRE NX.');
    }
  } catch { errors.push('Không kết nối được Redis. Kiểm tra REDIS_URL và dịch vụ Redis.'); }
  finally { if (redis.isOpen) await redis.disconnect(); }
  return { errors, pending, schemaItems };
}

async function main() {
  dotenv.config({ quiet: true });
  const result = await inspectEnvironment();
  for (const item of result.schemaItems || []) {
    if (item.status === 'OK') {
      console.log(`[OK] ${item.description}`);
    } else {
      console.error(`[LỖI] ${item.description}${item.hint ? ` (Cách sửa: ${item.hint})` : ''}`);
    }
  }
  const hasSchemaErrors = (result.schemaItems || []).some((i) => i.status !== 'OK');
  for (const error of result.errors) console.error(`[LỖI] ${error}`);
  if (result.pending.length) console.log(`[INFO] ${result.pending.length} migration chờ chạy; dùng npm run setup.`);
  const isFail = result.errors.length > 0 || (result.schemaItems && result.schemaItems.length > 0 && hasSchemaErrors);
  console.log(isFail ? 'DOCTOR: FAIL' : 'DOCTOR: PASS');
  process.exitCode = isFail ? 1 : 0;
}
if (require.main === module) main().catch(() => { console.error('DOCTOR: FAIL'); process.exitCode = 1; });
module.exports = { validateEnvironment, compareMigrations, inspectEnvironment };
