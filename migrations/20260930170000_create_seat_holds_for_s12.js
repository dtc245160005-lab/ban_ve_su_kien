/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('seat_holds', (table) => {
    table.increments('id').primary();
    table.integer('seat_id').notNullable()
      .references('id').inTable('seats').onDelete('CASCADE');
    table.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    // T-33+ sẽ bổ sung FK khi bảng orders tồn tại. Giá trị khác null đánh dấu
    // lượt giữ đã chuyển sang quy trình đơn hàng và không được job T-27 xóa.
    table.integer('order_id').nullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['seat_id', 'expires_at']);
    table.index(['user_id', 'expires_at']);
    table.index('expires_at');
    table.index('order_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('seat_holds');
};
