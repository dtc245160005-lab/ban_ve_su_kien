const { Client } = require('pg');
const dotenv = require('dotenv');

/**
 * Tạo cơ sở dữ liệu ứng dụng nếu chưa tồn tại.
 * Kết nối qua database bảo trì (mặc định 'postgres') với thông tin từ DB_CONNECTION_STRING.
 *
 * @param {object} options
 * @param {string} [options.connectionString]
 * @returns {Promise<{ created: boolean, database: string }>}
 */
async function createDatabase({ connectionString = process.env.DB_CONNECTION_STRING } = {}) {
  if (!connectionString) {
    throw new Error('Thiếu DB_CONNECTION_STRING trong biến môi trường (.env).');
  }

  let targetUrl;
  try {
    targetUrl = new URL(connectionString);
  } catch {
    throw new Error('DB_CONNECTION_STRING không phải URL hợp lệ.');
  }

  const targetDb = decodeURIComponent(targetUrl.pathname.replace(/^\//, '')).trim();
  if (!targetDb) {
    throw new Error('DB_CONNECTION_STRING không chứa tên database đích.');
  }

  // Kết nối qua database 'postgres' mặc định để thực hiện CREATE DATABASE
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const client = new Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
  } catch (err) {
    if (err.code === '28P01' || err.code === '28000') {
      throw new Error(
        `[LỖI] Sai thông tin xác thực PostgreSQL (mã ${err.code}). Vui lòng cập nhật mật khẩu PostgreSQL thực tế của bạn trong file .env (biến DB_CONNECTION_STRING).`,
        { cause: err }
      );
    }
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        `[LỖI] Không thể kết nối tới PostgreSQL tại ${adminUrl.host} (ECONNREFUSED). Hãy đảm bảo dịch vụ PostgreSQL đang chạy.`,
        { cause: err }
      );
    }
    throw new Error(`[LỖI] Không thể kết nối tới PostgreSQL để tạo database: ${err.message}`, { cause: err });
  }

  try {
    const checkRes = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );

    if (checkRes.rows.length > 0) {
      console.log(`[DB CREATE] Cơ sở dữ liệu "${targetDb}" đã tồn tại sẵn.`);
      return { created: false, database: targetDb };
    }

    // Tên database được escape bằng dấu ngoặc kép an toàn
    const safeDbName = targetDb.replace(/"/g, '""');
    await client.query(`CREATE DATABASE "${safeDbName}"`);
    console.log(`[DB CREATE] Đã tạo cơ sở dữ liệu "${targetDb}" thành công.`);
    return { created: true, database: targetDb };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  dotenv.config({ quiet: true });
  try {
    await createDatabase();
    process.exitCode = 0;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { createDatabase };
