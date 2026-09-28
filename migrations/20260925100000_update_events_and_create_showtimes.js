/**
 * Migration cập nhật bảng events và tạo bảng showtimes (T-09)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // 1. Thêm các cột mới cho events (owner_id tạm thời nullable để kiểm tra và gán cho dữ liệu cũ)
  await knex.schema.alterTable('events', function (table) {
    table.integer('owner_id').unsigned().nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('venue', 255).nullable();
    table.string('status', 20).notNullable().defaultTo('draft');
  });

  // Thêm CHECK constraint cho status của events
  await knex.raw("ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'published', 'archived'))");

  // Xử lý dữ liệu cũ: nếu có bản ghi events chưa có owner_id
  const unownedCountResult = await knex('events').whereNull('owner_id').count('* as count');
  const unownedCount = Number(unownedCountResult[0]?.count || 0);

  if (unownedCount > 0) {
    const adminRole = await knex('roles').where({ name: 'admin' }).first();
    let earliestAdmin = null;
    if (adminRole) {
      earliestAdmin = await knex('users')
        .join('user_roles', 'users.id', 'user_roles.user_id')
        .where('user_roles.role_id', adminRole.id)
        .orderBy('users.created_at', 'asc')
        .orderBy('users.id', 'asc')
        .select('users.id')
        .first();
    }

    if (!earliestAdmin) {
      throw new Error('Không thể gán owner_id cho sự kiện cũ vì hệ thống chưa có tài khoản admin.');
    }

    await knex('events').whereNull('owner_id').update({ owner_id: earliestAdmin.id });
  }

  // Đổi owner_id sang NOT NULL, title tối đa 200 ký tự, xoá price và total_tickets, thêm index (owner_id, status)
  await knex.schema.alterTable('events', function (table) {
    table.integer('owner_id').unsigned().notNullable().alter();
    table.string('title', 200).notNullable().alter();
    table.dropColumn('price');
    table.dropColumn('total_tickets');
    table.index(['owner_id', 'status']);
  });

  // 2. Tạo bảng showtimes (ON DELETE RESTRICT: không xoá sự kiện nếu còn suất diễn)
  await knex.schema.createTable('showtimes', function (table) {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable().references('id').inTable('events').onDelete('RESTRICT');
    table.timestamp('starts_at', { useTz: true }).notNullable();
    table.string('room_name', 100).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['event_id', 'starts_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Xóa bảng con trước theo đúng thứ tự phụ thuộc ngược
  await knex.schema.dropTableIfExists('showtimes');

  // Rollback bảng events: thêm lại price và total_tickets (cho phép null), xoá các cột mới
  await knex.raw('ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check');
  await knex.schema.alterTable('events', function (table) {
    table.dropIndex(['owner_id', 'status']);
    table.dropColumn('owner_id');
    table.dropColumn('venue');
    table.dropColumn('status');
    table.decimal('price', 10, 2).nullable();
    table.integer('total_tickets').nullable();
    table.string('title', 255).notNullable().alter();
  });
};
