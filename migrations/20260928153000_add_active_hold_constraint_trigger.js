/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // T-29: Bỏ constraint unique tĩnh để cho phép nhiều record đã hết hạn
  await knex.schema.alterTable('seat_holds', function(table) {
    table.dropUnique(['seat_id']);
  });

  // Tạo hàm trigger chặn 2 giữ chỗ CÒN HIỆU LỰC
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_active_hold() RETURNS TRIGGER AS $$
    BEGIN
      -- Khóa advisory lock theo seat_id để serialize các giao dịch đồng thời chèn cùng ghế
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seat_id));

      IF EXISTS (
        SELECT 1 FROM seat_holds 
        WHERE seat_id = NEW.seat_id 
          AND expires_at > NOW() 
          AND id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'seat_already_held_active:%', NEW.seat_id;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Gắn trigger vào bảng
  await knex.raw(`
    CREATE TRIGGER trg_check_active_hold
    BEFORE INSERT OR UPDATE ON seat_holds
    FOR EACH ROW EXECUTE FUNCTION check_active_hold();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_active_hold ON seat_holds');
  await knex.raw('DROP FUNCTION IF EXISTS check_active_hold()');
  
  await knex.schema.alterTable('seat_holds', function(table) {
    table.unique(['seat_id']);
  });
};
