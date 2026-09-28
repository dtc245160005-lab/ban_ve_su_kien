const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config();

function findPgDump() {
  if (process.env.PG_DUMP_PATH) {
    return process.env.PG_DUMP_PATH;
  }

  const isWindows = process.platform === 'win32';
  const defaultCmd = isWindows ? 'pg_dump.exe' : 'pg_dump';

  const check = spawnSync(defaultCmd, ['--version'], { stdio: 'ignore' });
  if (check.status === 0) {
    return defaultCmd;
  }

  if (isWindows) {
    const programFilesDirs = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
    ].filter(Boolean);

    for (const pf of programFilesDirs) {
      const pgDir = path.join(pf, 'PostgreSQL');
      if (fs.existsSync(pgDir)) {
        try {
          const versions = fs.readdirSync(pgDir);
          for (const v of versions) {
            const candidate = path.join(pgDir, v, 'bin', 'pg_dump.exe');
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
        } catch {
          // Bỏ qua lỗi truy cập thư mục
        }
      }
    }
  }

  return defaultCmd;
}

function runBackup() {
  const connectionString = process.env.DB_CONNECTION_STRING;
  if (!connectionString) {
    console.error('[BACKUP] [THẤT BẠI] Thiếu biến môi trường DB_CONNECTION_STRING.');
    process.exit(1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch (err) {
    console.error(`[BACKUP] [THẤT BẠI] DB_CONNECTION_STRING không đúng định dạng URL: ${err.message}`);
    process.exit(1);
  }

  const host = parsedUrl.hostname || 'localhost';
  const port = parsedUrl.port || '5432';
  const dbName = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : 'postgres';
  const username = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : 'postgres';
  const password = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '';

  // Xóa mật khẩu khỏi URI trước khi chuyển làm tham số lệnh để bảo vệ bí mật
  parsedUrl.password = '';
  const cleanDbUri = parsedUrl.toString();

  const backupDir = path.resolve(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupFileName = `backup_${timestamp}.sql`;
  const backupFilePath = path.join(backupDir, backupFileName);

  console.log('[BACKUP] Đang tiến hành sao lưu cơ sở dữ liệu PostgreSQL...');
  console.log(`[BACKUP] Máy chủ: ${host}:${port} | Database: ${dbName} | User: ${username}`);

  const pgDumpBinary = findPgDump();
  const args = ['--dbname', cleanDbUri, '-f', backupFilePath];
  const env = {
    ...process.env,
    ...(password ? { PGPASSWORD: password } : {}),
  };

  const result = spawnSync(pgDumpBinary, args, {
    env,
    encoding: 'utf8',
  });

  if (result.error) {
    console.error(`[BACKUP] [THẤT BẠI] Không thể thực thi pg_dump: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[BACKUP] [THẤT BẠI] pg_dump thoát với mã lỗi ${result.status}:`);
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(1);
  }

  console.log(`[BACKUP] [THÀNH CÔNG] File sao lưu đã được tạo: ${backupFilePath}`);
}

if (require.main === module) {
  runBackup();
}

module.exports = { runBackup, findPgDump };
