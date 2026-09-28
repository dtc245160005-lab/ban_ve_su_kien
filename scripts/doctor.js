const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { createClient } = require('redis');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const examplePath = path.join(rootDir, '.env.example');

async function main() {
  console.log('\n============================================================');
  console.log('           BÁC SĨ HỆ THỐNG (SYSTEM DOCTOR)                  ');
  console.log('============================================================\n');

  let hasError = false;

  // 1. Kiểm tra phiên bản Node.js tối thiểu (>= 20)
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    hasError = true;
    console.log(`[LỖI] Phiên bản Node.js hiện tại là v${process.versions.node} (yêu cầu tối thiểu >= 20).`);
    console.log(`      -> Cách sửa: Cài đặt hoặc chuyển sang Node.js 20 trở lên qua nvm (nvm use 20) hoặc tải từ https://nodejs.org.\n`);
  } else {
    console.log(`[OK] Phiên bản Node.js: v${process.versions.node} (đáp ứng yêu cầu >= 20).\n`);
  }

  // 2. Kiểm tra file .env và sự đầy đủ của các biến môi trường
  let envParsed = {};
  if (!fs.existsSync(envPath)) {
    hasError = true;
    console.log(`[LỖI] Không tìm thấy file .env trong thư mục gốc.`);
    console.log(`      -> Cách sửa: Sao chép từ .env.example bằng lệnh 'cp .env.example .env' (hoặc 'Copy-Item .env.example .env' trên Windows) và cấu hình các biến phù hợp.\n`);
  } else {
    console.log(`[OK] File .env đã tồn tại.`);

    // Đọc danh sách key từ .env.example
    let exampleKeys = [];
    if (fs.existsSync(examplePath)) {
      const exampleContent = fs.readFileSync(examplePath, 'utf8');
      const exampleParsed = dotenv.parse(exampleContent);
      exampleKeys = Object.keys(exampleParsed);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    envParsed = dotenv.parse(envContent);

    // Bổ sung các biến đã có vào process.env
    dotenv.config({ path: envPath });

    const missingKeys = exampleKeys.filter((k) => !(k in envParsed) && !process.env[k]);
    if (missingKeys.length > 0) {
      hasError = true;
      console.log(`[LỖI] Thiếu các biến môi trường trong file .env: ${missingKeys.join(', ')}`);
      console.log(`      -> Cách sửa: Bổ sung các biến trên vào file .env theo mẫu trong .env.example.\n`);
    } else {
      console.log(`[OK] Cấu hình .env đầy đủ các biến theo .env.example.\n`);
    }
  }

  // 3. Kiểm tra kết nối PostgreSQL
  let pgClient = null;
  let pgConnected = false;
  const dbUrl = process.env.DB_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5432/postgres';

  try {
    pgClient = new Client({
      connectionString: dbUrl,
      connectionTimeoutMillis: 5000,
    });
    await pgClient.connect();
    await pgClient.query('SELECT 1');
    pgConnected = true;
    console.log(`[OK] Kết nối cơ sở dữ liệu PostgreSQL thành công.\n`);
  } catch (err) {
    hasError = true;
    console.log(`[LỖI] Không thể kết nối cơ sở dữ liệu PostgreSQL (${err.message}).`);
    console.log(`      -> Cách sửa: Khởi động database bằng 'docker compose up -d db' hoặc kiểm tra DB_CONNECTION_STRING trong .env.\n`);
  }

  // 4. Kiểm tra kết nối Redis
  let redisClient = null;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    redisClient = createClient({
      url: redisUrl,
      socket: { connectTimeout: 5000 },
    });
    await redisClient.connect();
    const pong = await redisClient.ping();
    if (pong !== 'PONG') {
      throw new Error('Phản hồi ping không hợp lệ');
    }
    console.log(`[OK] Kết nối Redis cache thành công.\n`);
  } catch (err) {
    hasError = true;
    console.log(`[LỖI] Không thể kết nối Redis (${err.message}).`);
    console.log(`      -> Cách sửa: Khởi động Redis bằng 'docker compose up -d redis' hoặc kiểm tra REDIS_URL trong .env.\n`);
  } finally {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit().catch(() => {});
    }
  }

  // 5. Kiểm tra migration có khớp không
  if (pgConnected && pgClient) {
    try {
      const tableCheck = await pgClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'knex_migrations';
      `);

      if (tableCheck.rows.length === 0) {
        console.log(`[OK] Chưa có migration nào được chạy (sẵn sàng chạy 'npm run setup').\n`);
      } else {
        const res = await pgClient.query('SELECT name FROM knex_migrations ORDER BY id ASC;');
        const recordedMigrations = res.rows.map((r) => r.name);

        const migrationsDir = path.join(rootDir, 'migrations');
        const localFiles = fs.existsSync(migrationsDir)
          ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js'))
          : [];
        const localSet = new Set(localFiles);

        const orphanMigrations = recordedMigrations.filter((m) => !localSet.has(m));
        if (orphanMigrations.length > 0) {
          hasError = true;
          console.log(`[LỖI] DB cũ từ nhánh khác, chạy docker compose down -v`);
          console.log(`      -> Chi tiết: Tìm thấy ${orphanMigrations.length} migration trong database nhưng không tồn tại trong thư mục migrations/:`);
          for (const orphan of orphanMigrations) {
            console.log(`         - ${orphan}`);
          }
          console.log(`      -> Cách sửa: Chạy 'docker compose down -v' để xoá volume database cũ, sau đó chạy 'docker compose up -d db' và 'npm run setup'.\n`);
        } else {
          console.log(`[OK] Lịch sử migration trong database khớp với các file trong thư mục migrations/ (${recordedMigrations.length} migrations).\n`);
        }
      }
    } catch (err) {
      hasError = true;
      console.log(`[LỖI] Không thể kiểm tra lịch sử migration trong database (${err.message}).`);
      console.log(`      -> Cách sửa: Kiểm tra quyền truy cập bảng knex_migrations hoặc chạy 'docker compose down -v'.\n`);
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  // 6. Kiểm tra DEMO_*_PASSWORD có còn là giá trị mẫu không
  const samplePasswords = new Set([
    'your_demo_admin_password',
    'your_demo_organizer_password',
    'DemoAdmin@123456',
    'DemoOrganizer@123456',
    'admin',
    'password',
    '123456',
    'changeme',
  ]);

  const adminPass = (process.env.DEMO_ADMIN_PASSWORD || '').trim();
  const orgPass = (process.env.DEMO_ORGANIZER_PASSWORD || '').trim();

  const isDefaultAdmin = !adminPass || samplePasswords.has(adminPass);
  const isDefaultOrg = !orgPass || samplePasswords.has(orgPass);

  if (isDefaultAdmin || isDefaultOrg) {
    console.log(`[CẢNH BÁO] DEMO_ADMIN_PASSWORD hoặc DEMO_ORGANIZER_PASSWORD đang sử dụng giá trị mẫu mặc định.`);
    console.log(`           -> Cách sửa: Cập nhật mật khẩu mạnh và an toàn trong file .env trước khi triển khai môi trường production.\n`);
  } else {
    console.log(`[OK] Mật khẩu tài khoản demo đã được tuỳ biến, không dùng giá trị mẫu mặc định.\n`);
  }

  console.log('------------------------------------------------------------');
  if (hasError) {
    console.log('KẾT QUẢ: Phát hiện lỗi cấu hình cần xử lý trước khi chạy ứng dụng.');
    console.log('============================================================\n');
    process.exit(1);
  } else {
    console.log('KẾT QUẢ: Toàn bộ kiểm tra đều ĐẠT! Môi trường sẵn sàng hoạt động.');
    console.log('============================================================\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\n[LỖI HỆ THỐNG]', err.message);
  process.exit(1);
});
