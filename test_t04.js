const argon2 = require('argon2');
const db = require('./db');

async function runTests() {
  const results = [];

  function record(name, status, details = '') {
    results.push({ name, status, details });
    const symbol = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${symbol} [${status}] ${name}${details ? ': ' + details : ''}`);
  }

  try {
    console.log('========================================');
    console.log('   BẮT ĐẦU KIỂM THỬ TASK T-04');
    console.log('========================================\n');

    // Test 1: Xác nhận kết nối PostgreSQL an toàn
    try {
      await db.raw('SELECT 1 as connected');
      record('1. Kết nối PostgreSQL an toàn', 'PASS', 'Kết nối thành công (không in chuỗi kết nối hay mật khẩu)');
    } catch (err) {
      record('1. Kết nối PostgreSQL an toàn', 'FAIL', err.message);
      throw err;
    }

    // Test 2: Kiểm tra trạng thái migration trước khi chạy
    try {
      const [completed, pending] = await db.migrate.list();
      record('2. Kiểm tra trạng thái migration', 'PASS', `Đã hoàn thành: ${completed.length}, Đang chờ: ${pending.length}`);
    } catch (err) {
      record('2. Kiểm tra trạng thái migration', 'FAIL', err.message);
    }

    // Test 3: Chạy migration
    try {
      await db.migrate.latest();
      const hasRoles = await db.schema.hasTable('roles');
      const hasUsers = await db.schema.hasTable('users');
      const hasUserRoles = await db.schema.hasTable('user_roles');
      if (hasRoles && hasUsers && hasUserRoles) {
        record('3. Chạy migration T-04 (roles, users, user_roles)', 'PASS', 'Cả 3 bảng đã được tạo thành công');
      } else {
        record('3. Chạy migration T-04 (roles, users, user_roles)', 'FAIL', `roles: ${hasRoles}, users: ${hasUsers}, user_roles: ${hasUserRoles}`);
      }
    } catch (err) {
      record('3. Chạy migration T-04 (roles, users, user_roles)', 'FAIL', err.message);
    }

    // Test 4: Chạy seed lần 1
    try {
      await db.seed.run();
      record('4. Chạy seed lần thứ nhất', 'PASS', 'Seed thành công lần 1');
    } catch (err) {
      record('4. Chạy seed lần thứ nhất', 'FAIL', err.message);
    }

    // Test 5: Chạy seed lần 2 (kiểm tra tính idempotent)
    try {
      await db.seed.run();
      record('5. Chạy seed lần thứ hai (Idempotent)', 'PASS', 'Seed thành công lần 2 mà không có lỗi');
    } catch (err) {
      record('5. Chạy seed lần thứ hai (Idempotent)', 'FAIL', err.message);
    }

    // Test 6: Xác nhận dữ liệu trong database (tương thích với database có dữ liệu khác)
    let adminUser = null;
    let organizerUser = null;
    let roleMap = new Map();
    try {
      const roles = await db('roles').select('id', 'name');
      roles.forEach((r) => roleMap.set(r.name, r.id));

      const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
      const hasAllRequiredRoles = requiredRoles.every((r) => roleMap.has(r));

      adminUser = await db('users').where({ email: process.env.DEMO_ADMIN_EMAIL }).first();
      organizerUser = await db('users').where({ email: process.env.DEMO_ORGANIZER_EMAIL }).first();
      const demoUsersExist = Boolean(adminUser && organizerUser);

      let adminHasAdminRole = false;
      let organizerHasOrganizerRole = false;

      if (demoUsersExist && roleMap.has('admin') && roleMap.has('organizer')) {
        const adminRoleAssignment = await db('user_roles')
          .where({ user_id: adminUser.id, role_id: roleMap.get('admin') })
          .first();
        const organizerRoleAssignment = await db('user_roles')
          .where({ user_id: organizerUser.id, role_id: roleMap.get('organizer') })
          .first();
        adminHasAdminRole = Boolean(adminRoleAssignment);
        organizerHasOrganizerRole = Boolean(organizerRoleAssignment);
      }

      if (hasAllRequiredRoles && demoUsersExist && adminHasAdminRole && organizerHasOrganizerRole) {
        record(
          '6. Xác nhận tồn tại đủ 5 roles, 2 demo users và phân quyền demo',
          'PASS',
          'Tồn tại đủ 5 roles bắt buộc, đủ 2 demo users, gán đúng role admin và organizer (hỗ trợ DB có thêm dữ liệu khác)'
        );
      } else {
        record(
          '6. Xác nhận tồn tại đủ 5 roles, 2 demo users và phân quyền demo',
          'FAIL',
          `hasRequiredRoles: ${hasAllRequiredRoles}, demoUsersExist: ${demoUsersExist}, adminRole: ${adminHasAdminRole}, organizerRole: ${organizerHasOrganizerRole}`
        );
      }
    } catch (err) {
      record('6. Xác nhận tồn tại đủ 5 roles, 2 demo users và phân quyền demo', 'FAIL', err.message);
    }

    // Test 7: Xác nhận password_hash là Argon2id và kiểm tra verify
    try {
      const isAdminArgon2id = adminUser.password_hash.startsWith('$argon2id$');
      const isOrganizerArgon2id = organizerUser.password_hash.startsWith('$argon2id$');
      const notRawAdmin = adminUser.password_hash !== process.env.DEMO_ADMIN_PASSWORD;
      const notRawOrganizer = organizerUser.password_hash !== process.env.DEMO_ORGANIZER_PASSWORD;

      const adminVerified = await argon2.verify(adminUser.password_hash, process.env.DEMO_ADMIN_PASSWORD);
      const organizerVerified = await argon2.verify(organizerUser.password_hash, process.env.DEMO_ORGANIZER_PASSWORD);

      if (isAdminArgon2id && isOrganizerArgon2id && notRawAdmin && notRawOrganizer && adminVerified && organizerVerified) {
        record('7. Xác nhận password_hash chuẩn Argon2id và không bằng mật khẩu thô', 'PASS', 'Mật khẩu demo được hash bằng argon2id và xác thực thành công');
      } else {
        record('7. Xác nhận password_hash chuẩn Argon2id và không bằng mật khẩu thô', 'FAIL', 'Kiểm tra hash hoặc verify thất bại');
      }
    } catch (err) {
      record('7. Xác nhận password_hash chuẩn Argon2id và không bằng mật khẩu thô', 'FAIL', err.message);
    }

    // Test 8: Kiểm tra ràng buộc UNIQUE email bằng transaction an toàn
    try {
      let uniqueCaught = false;
      const trx = await db.transaction();
      try {
        await trx('users').insert({
          email: process.env.DEMO_ADMIN_EMAIL,
          password_hash: '$argon2id$dummyhashforemailtest',
          is_active: true,
        });
      } catch (err) {
        if (err.code === '23505' || err.message.includes('unique') || err.message.includes('duplicate')) {
          uniqueCaught = true;
        }
      } finally {
        await trx.rollback();
      }

      if (uniqueCaught) {
        record('8. Kiểm tra ràng buộc UNIQUE email của users', 'PASS', 'Đã bắt lỗi duplicate key và rollback an toàn, không để lại dữ liệu thử');
      } else {
        record('8. Kiểm tra ràng buộc UNIQUE email của users', 'FAIL', 'Không bắt được lỗi vi phạm unique constraint');
      }
    } catch (err) {
      record('8. Kiểm tra ràng buộc UNIQUE email của users', 'FAIL', err.message);
    }

    // Test 9: Kiểm tra khóa chính ghép của user_roles
    try {
      let pkCaught = false;
      const trx = await db.transaction();
      try {
        await trx('user_roles').insert({
          user_id: adminUser.id,
          role_id: roleMap.get('admin'),
        });
      } catch (err) {
        if (err.code === '23505' || err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('primary')) {
          pkCaught = true;
        }
      } finally {
        await trx.rollback();
      }

      if (pkCaught) {
        record('9. Kiểm tra khóa chính ghép của user_roles (không cho phép gán trùng role)', 'PASS', 'Đã bắt lỗi duplicate primary key và rollback an toàn');
      } else {
        record('9. Kiểm tra khóa chính ghép của user_roles (không cho phép gán trùng role)', 'FAIL', 'Không bắt được lỗi vi phạm khóa chính ghép');
      }
    } catch (err) {
      record('9. Kiểm tra khóa chính ghép của user_roles (không cho phép gán trùng role)', 'FAIL', err.message);
    }

    // Test 10: Kiểm tra rollback và migrate lại an toàn
    try {
      const migrations = await db('knex_migrations').select('*').orderBy('id', 'asc');
      const eventsMigration = migrations.find((m) => m.name.includes('create_events_table'));
      const t04Migration = migrations.find((m) => m.name.includes('create_roles_users'));

      // Tính batch lớn nhất hiện tại
      const maxBatch = migrations.length > 0 ? Math.max(...migrations.map((m) => m.batch)) : 0;
      const maxBatchMigrations = migrations.filter((m) => m.batch === maxBatch);

      // 4 điều kiện an toàn bắt buộc trước khi rollback:
      // 1. Migration T-04 tồn tại
      const t04Exists = Boolean(t04Migration);
      // 2. Batch của T-04 là batch lớn nhất hiện tại
      const t04IsMaxBatch = t04Exists && t04Migration.batch === maxBatch;
      // 3. Batch lớn nhất CHỈ CHỨA migration T-04
      const maxBatchOnlyT04 = maxBatchMigrations.length === 1 && t04Exists && maxBatchMigrations[0].id === t04Migration.id;
      // 4. Migration Events nằm ở batch thấp hơn
      const eventsAtLowerBatch = Boolean(eventsMigration && t04Exists && eventsMigration.batch < t04Migration.batch);

      const canSafelyRollback = t04Exists && t04IsMaxBatch && maxBatchOnlyT04 && eventsAtLowerBatch;

      if (!canSafelyRollback) {
        let skipReason = 'Rollback bị bỏ qua để tránh ảnh hưởng migration của task khác: ';
        if (!t04Exists) skipReason += 'Không tìm thấy migration T-04 trong knex_migrations.';
        else if (!t04IsMaxBatch) skipReason += `Batch của T-04 (batch ${t04Migration.batch}) không phải là batch lớn nhất (${maxBatch}).`;
        else if (!maxBatchOnlyT04) skipReason += `Batch lớn nhất (${maxBatch}) chứa ${maxBatchMigrations.length} migrations, không thể rollback riêng T-04.`;
        else if (!eventsAtLowerBatch) skipReason += 'Migration Events không nằm ở batch thấp hơn T-04.';

        record('10. Kiểm tra migration down/up an toàn', 'SKIPPED', skipReason);
      } else {
        // Rollback batch gần nhất (chính là T-04)
        await db.migrate.rollback();

        const hasRolesAfter = await db.schema.hasTable('roles');
        const hasUsersAfter = await db.schema.hasTable('users');
        const hasUserRolesAfter = await db.schema.hasTable('user_roles');
        const hasEventsAfter = await db.schema.hasTable('events');

        const onlyT04Dropped = !hasRolesAfter && !hasUsersAfter && !hasUserRolesAfter && hasEventsAfter;

        // Migrate lại lên latest
        await db.migrate.latest();

        const hasRolesReup = await db.schema.hasTable('roles');
        const hasUsersReup = await db.schema.hasTable('users');
        const hasUserRolesReup = await db.schema.hasTable('user_roles');
        const hasEventsReup = await db.schema.hasTable('events');

        if (onlyT04Dropped && hasRolesReup && hasUsersReup && hasUserRolesReup && hasEventsReup) {
          record('10. Kiểm tra migration down/up an toàn', 'PASS', 'Rollback chỉ xóa ba bảng T-04 và bảo toàn bảng events; sau đó migrate lại thành công');
        } else {
          record('10. Kiểm tra migration down/up an toàn', 'FAIL', `Trạng thái bảng sau rollback: roles=${hasRolesAfter}, users=${hasUsersAfter}, user_roles=${hasUserRolesAfter}, events=${hasEventsAfter}`);
        }
      }
    } catch (err) {
      record('10. Kiểm tra migration down/up an toàn', 'FAIL', err.message);
    }

    // Test 11: Sau khi migrate lại, chạy seed và kiểm tra lại lần cuối (tương thích DB có dữ liệu khác)
    try {
      await db.seed.run();

      const roles = await db('roles').select('id', 'name');
      const roleMapFinal = new Map(roles.map((r) => [r.name, r.id]));
      const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
      const hasAllRequiredRoles = requiredRoles.every((r) => roleMapFinal.has(r));

      const adminFinal = await db('users').where({ email: process.env.DEMO_ADMIN_EMAIL }).first();
      const organizerFinal = await db('users').where({ email: process.env.DEMO_ORGANIZER_EMAIL }).first();
      const demoUsersExist = Boolean(adminFinal && organizerFinal);

      let adminHasAdminRole = false;
      let organizerHasOrganizerRole = false;

      if (demoUsersExist && roleMapFinal.has('admin') && roleMapFinal.has('organizer')) {
        const adminRoleAssignment = await db('user_roles')
          .where({ user_id: adminFinal.id, role_id: roleMapFinal.get('admin') })
          .first();
        const organizerRoleAssignment = await db('user_roles')
          .where({ user_id: organizerFinal.id, role_id: roleMapFinal.get('organizer') })
          .first();
        adminHasAdminRole = Boolean(adminRoleAssignment);
        organizerHasOrganizerRole = Boolean(organizerRoleAssignment);
      }

      if (hasAllRequiredRoles && demoUsersExist && adminHasAdminRole && organizerHasOrganizerRole) {
        record(
          '11. Chạy seed và kiểm tra lại lần cuối sau khi migrate lại',
          'PASS',
          'CSDL bảo đảm đầy đủ 5 roles bắt buộc, 2 demo users và phân quyền demo chính xác (hỗ trợ DB có thêm dữ liệu khác)'
        );
      } else {
        record(
          '11. Chạy seed và kiểm tra lại lần cuối sau khi migrate lại',
          'FAIL',
          `hasRequiredRoles: ${hasAllRequiredRoles}, demoUsersExist: ${demoUsersExist}, adminRole: ${adminHasAdminRole}, organizerRole: ${organizerHasOrganizerRole}`
        );
      }
    } catch (err) {
      record('11. Chạy seed và kiểm tra lại lần cuối sau khi migrate lại', 'FAIL', err.message);
    }

    console.log('\n========================================');
    console.log('   KẾT QUẢ TỔNG QUAN BÀI KIỂM THỬ');
    console.log('========================================');
    const total = results.length;
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIPPED').length;
    console.log(`Tổng số: ${total} | Đạt (PASS): ${passed} | Thất bại (FAIL): ${failed} | Bỏ qua (SKIPPED): ${skipped}\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Lỗi nghiêm trọng trong quá trình kiểm thử:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

runTests();
