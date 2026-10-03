exports.up = async function(knex) {
  await knex.schema.createTable('orders', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('event_id').unsigned().notNullable();
    table.foreign('event_id').references('id').inTable('events').onDelete('CASCADE');
    table.string('status').notNullable().defaultTo('chờ'); // chờ, đã trả, đã huỷ, hết hạn
    table.integer('total_amount').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamps(true, true);
  });

  // Partial unique index to enforce "một đơn chờ cho mỗi người mỗi suất" (T-37)
  await knex.raw(`
    CREATE UNIQUE INDEX user_event_pending_order_unique 
    ON orders (user_id, event_id) 
    WHERE status = 'chờ';
  `);

  await knex.schema.createTable('order_items', function(table) {
    table.increments('id').primary();
    table.integer('order_id').unsigned().notNullable();
    table.foreign('order_id').references('id').inTable('orders').onDelete('CASCADE');
    table.string('seat_id').notNullable();
    table.integer('price_at_booking').notNullable();
  });

  // Trigger to enforce "mỗi ghế chỉ được nằm trong một đơn chưa huỷ của cùng suất diễn"
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_seat_in_active_order() RETURNS TRIGGER AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seat_id));

      IF EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE oi.seat_id = NEW.seat_id
          AND o.status != 'đã huỷ'
          AND o.event_id = (SELECT event_id FROM orders WHERE id = NEW.order_id)
          AND oi.id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'seat_already_in_active_order:%', NEW.seat_id;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_check_seat_in_active_order
    BEFORE INSERT OR UPDATE ON order_items
    FOR EACH ROW EXECUTE FUNCTION check_seat_in_active_order();
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_seat_in_active_order ON order_items');
  await knex.raw('DROP FUNCTION IF EXISTS check_seat_in_active_order()');
  await knex.schema.dropTableIfExists('order_items');
  
  await knex.raw('DROP INDEX IF EXISTS user_event_pending_order_unique');
  await knex.schema.dropTableIfExists('orders');
};
