/**
 * Dịch vụ kiểm tra schema database dùng chung giữa scripts/doctor.js và index.js (start)
 */

async function executeQuery(client, sql, params = []) {
  if (typeof client.raw === 'function') {
    const res = await client.raw(sql, params);
    return res.rows || res;
  }
  if (typeof client.query === 'function') {
    const res = await client.query(sql, params);
    return res.rows || res;
  }
  throw new Error('Unsupported database client in schemaCheck');
}

async function checkSchema(client) {
  const items = [];
  let allOk = true;

  // 1. Kiểm tra các bảng tồn tại
  const tablesRes = await executeQuery(client, `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const existingTables = new Set(tablesRes.map((r) => r.table_name));

  // Kiểm tra bảng seats
  if (existingTables.has('seats')) {
    items.push({ id: 'table_seats', description: 'Bảng seats: tồn tại', status: 'OK' });
  } else {
    allOk = false;
    items.push({
      id: 'table_seats',
      description: 'Bảng seats: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  }

  // Kiểm tra bảng seat_categories
  if (existingTables.has('seat_categories')) {
    items.push({ id: 'table_seat_categories', description: 'Bảng seat_categories: tồn tại', status: 'OK' });
  } else {
    allOk = false;
    items.push({
      id: 'table_seat_categories',
      description: 'Bảng seat_categories: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  }

  // 2. Kiểm tra các cột bắt buộc trong information_schema.columns
  const colsRes = await executeQuery(client, `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'email_activation_tokens', 'showtimes')
  `);
  const tableColumns = new Map();
  for (const row of colsRes) {
    if (!tableColumns.has(row.table_name)) {
      tableColumns.set(row.table_name, new Set());
    }
    tableColumns.get(row.table_name).add(row.column_name);
  }

  // users(full_name, is_active)
  if (!existingTables.has('users')) {
    allOk = false;
    items.push({
      id: 'cols_users',
      description: 'Bảng users: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  } else {
    const userCols = tableColumns.get('users') || new Set();
    const requiredUserCols = ['full_name', 'is_active'];
    const missingUserCols = requiredUserCols.filter((c) => !userCols.has(c));
    if (missingUserCols.length === 0) {
      items.push({ id: 'cols_users', description: 'users: có đủ cột (full_name, is_active)', status: 'OK' });
    } else {
      allOk = false;
      items.push({
        id: 'cols_users',
        description: `users: thiếu cột (${missingUserCols.join(', ')})`,
        status: 'LỖI',
        hint: 'Chạy npm run migrate:latest',
      });
    }
  }

  // email_activation_tokens(purpose, token_hash, used_at)
  if (!existingTables.has('email_activation_tokens')) {
    allOk = false;
    items.push({
      id: 'cols_email_activation_tokens',
      description: 'Bảng email_activation_tokens: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  } else {
    const tokenCols = tableColumns.get('email_activation_tokens') || new Set();
    const requiredTokenCols = ['purpose', 'token_hash', 'used_at'];
    const missingTokenCols = requiredTokenCols.filter((c) => !tokenCols.has(c));
    if (missingTokenCols.length === 0) {
      items.push({
        id: 'cols_email_activation_tokens',
        description: 'email_activation_tokens: có đủ cột (purpose, token_hash, used_at)',
        status: 'OK',
      });
    } else {
      allOk = false;
      items.push({
        id: 'cols_email_activation_tokens',
        description: `email_activation_tokens: thiếu cột (${missingTokenCols.join(', ')})`,
        status: 'LỖI',
        hint: 'Chạy npm run migrate:latest',
      });
    }
  }

  // showtimes(starts_at)
  if (!existingTables.has('showtimes')) {
    allOk = false;
    items.push({
      id: 'cols_showtimes',
      description: 'Bảng showtimes: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  } else {
    const showtimeCols = tableColumns.get('showtimes') || new Set();
    if (showtimeCols.has('starts_at')) {
      items.push({ id: 'cols_showtimes', description: 'showtimes: có đủ cột (starts_at)', status: 'OK' });
    } else {
      allOk = false;
      items.push({
        id: 'cols_showtimes',
        description: 'showtimes: thiếu cột (starts_at)',
        status: 'LỖI',
        hint: 'Chạy npm run migrate:latest',
      });
    }
  }

  // 3. Kiểm tra roles có đủ 5 vai trò hệ thống
  if (!existingTables.has('roles')) {
    allOk = false;
    items.push({
      id: 'roles_data',
      description: 'Bảng roles: chưa tồn tại',
      status: 'LỖI',
      hint: 'Chạy npm run migrate:latest',
    });
  } else {
    const rolesRes = await executeQuery(client, 'SELECT name FROM roles');
    const existingRoles = new Set(rolesRes.map((r) => r.name));
    const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
    const missingRoles = requiredRoles.filter((r) => !existingRoles.has(r));
    if (missingRoles.length === 0) {
      items.push({
        id: 'roles_data',
        description: 'roles: có đủ 5 vai trò hệ thống (buyer, organizer, checker, accountant, admin)',
        status: 'OK',
      });
    } else {
      allOk = false;
      items.push({
        id: 'roles_data',
        description: `roles: thiếu vai trò (${missingRoles.join(', ')})`,
        status: 'LỖI',
        hint: 'Chạy npm run migrate:latest',
      });
    }
  }

  return {
    ok: allOk,
    items,
  };
}

module.exports = {
  checkSchema,
};
