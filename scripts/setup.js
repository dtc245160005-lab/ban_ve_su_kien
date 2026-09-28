const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

// 1. Kiểm tra sự tồn tại của file .env (khi chạy ngoài container Docker)
const isDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);
if (!fs.existsSync(envPath) && !isDocker) {
  console.error('\n[SETUP LỖI] Chưa tìm thấy file .env trong thư mục gốc.');
  console.error('Vui lòng tạo file .env từ .env.example trước khi chạy setup:');
  console.error('  - Windows (PowerShell): Copy-Item .env.example .env');
  console.error('  - Windows (cmd): copy .env.example .env');
  console.error('  - Linux / macOS: cp .env.example .env\n');
  process.exit(1);
}

// 2. Tải biến môi trường từ .env nếu tồn tại
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const knexCliPath = path.join(rootDir, 'node_modules', 'knex', 'bin', 'cli.js');

function runKnex(args) {
  const result = spawnSync(process.execPath, [knexCliPath, ...args], {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
  });

  if (result.error) {
    console.error(`[SETUP LỖI] Không thể chạy knex ${args.join(' ')}:`, result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[SETUP LỖI] Lệnh knex ${args.join(' ')} thất bại với mã thoát: ${result.status}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[SETUP] 1. Chạy migration cơ sở dữ liệu (migrate:latest)...');
runKnex(['migrate:latest']);

console.log('\n[SETUP] 2. Khởi tạo dữ liệu mẫu ban đầu (seed:run)...');
runKnex(['seed:run']);

console.log('\n[SETUP THÀNH CÔNG] Cơ sở dữ liệu đã được cấu hình và seed dữ liệu mẫu thành công!\n');
