// Hướng chạy tiến: Tạo bảng events
exports.up = function(knex) {
  return knex.schema.createTable('events', function(table) {
    table.increments('id').primary();
    table.string('title').notNullable();
    table.text('description');
    table.decimal('price', 10, 2).notNullable();
    table.integer('total_tickets').notNullable();
    table.timestamps(true, true);
  });
};

// Hướng chạy lùi: Xóa bảng events nếu rollback
exports.down = function(knex) {
  return knex.schema.dropTable('events');
};