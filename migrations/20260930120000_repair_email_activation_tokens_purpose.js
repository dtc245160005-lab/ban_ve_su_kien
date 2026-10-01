/**
 * Migration sửa lệch schema: Bổ sung cột purpose cho email_activation_tokens nếu DB cũ chưa có.
 * Đảm bảo tính idempotent: DB mới đã có cột purpose thì không làm gì.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('email_activation_tokens');
  if (!hasTable) return;

  const hasPurpose = await knex.schema.hasColumn('email_activation_tokens', 'purpose');
  if (!hasPurpose) {
    await knex.schema.alterTable('email_activation_tokens', function(table) {
      table.specificType('purpose', 'varchar(16)').defaultTo('register').notNullable();
      table.index(['user_id', 'purpose', 'created_at']);
    });
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'email_activation_tokens_purpose_check'
        ) THEN
          ALTER TABLE email_activation_tokens
          ADD CONSTRAINT email_activation_tokens_purpose_check
          CHECK (purpose IN ('register', 'resend'));
        END IF;
      END $$;
    `);
  }
};

/**
 * Hàm down: Rollback hoàn chỉnh.
 * Khi rollback toàn bộ, migration 20260924100000 sẽ drop toàn bộ bảng email_activation_tokens.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(_knex) {
  // Không làm gì vì migration này chỉ là bản vá idempotent cho DB lệch;
  // migration gốc 20260924100000 sẽ drop toàn bộ bảng khi rollback.
};
