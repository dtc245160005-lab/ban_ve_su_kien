const defaultDb = require('../db');
const { AppError, assertCanManage } = require('./eventService');
const { validateSeatMapText } = require('../public/seatMapValidator');

function parseSeatMap(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  const result = validateSeatMapText(text);
  if (!result.valid) {
    const error = new AppError(400, 'Tệp sơ đồ không hợp lệ.');
    error.errors = result.errors;
    throw error;
  }
  return result.seats;
}

async function hasBooking(trx, table, showtimeId) {
  if (!await trx.schema.hasTable(table)) return false;

  const hasShowtimeId = await trx.schema.hasColumn(table, 'showtime_id');
  const hasSeatId = await trx.schema.hasColumn(table, 'seat_id');
  const hasExpiresAt = table === 'seat_holds' && await trx.schema.hasColumn(table, 'expires_at');

  let query = trx(table).select(trx.raw('1')).first();
  if (hasShowtimeId) {
    query = query.where('showtime_id', showtimeId);
  } else if (hasSeatId) {
    const { rows } = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint AS c
        JOIN pg_attribute AS column_info
          ON column_info.attrelid = c.conrelid
          AND column_info.attnum = ANY(c.conkey)
        WHERE c.conrelid = to_regclass(?)
          AND c.confrelid = to_regclass('seats')
          AND c.contype = 'f'
          AND column_info.attname = 'seat_id'
      ) AS has_fk
    `, [table]);
    if (rows[0].has_fk) {
      query = query.whereIn(trx.raw('??::text', ['seat_id']), trx('seats')
        .where('showtime_id', showtimeId).select(trx.raw('id::text')));
    } else {
      // A legacy string seat_id without a FK cannot be mapped reliably.
      const existingSeat = await trx('seats').where('showtime_id', showtimeId).first('id');
      if (!existingSeat) return false;
    }
  } else {
    // Unknown booking schema: do not discard seats while its ownership cannot be checked.
    const existingSeat = await trx('seats').where('showtime_id', showtimeId).first('id');
    if (!existingSeat) return false;
  }

  if (hasExpiresAt) query = query.where('expires_at', '>', trx.fn.now());
  return Boolean(await query);
}

function createSeatMapService(customDb = defaultDb) {
  async function importSeatMap(showtimeId, buffer, user) {
    if (!Number.isSafeInteger(showtimeId) || showtimeId <= 0) {
      throw new AppError(404, 'Suất diễn không tồn tại.');
    }
    const seats = parseSeatMap(buffer);

    try {
      return await customDb.transaction(async (trx) => {
        // Serializes imports for the same showtime, including first-time imports.
        const showtime = await trx('showtimes').where({ id: showtimeId }).forUpdate().first();
        if (!showtime) throw new AppError(404, 'Suất diễn không tồn tại.');
        const event = await trx('events').where({ id: showtime.event_id }).first();
        assertCanManage(user, event);

        if (await hasBooking(trx, 'tickets', showtimeId) ||
          await hasBooking(trx, 'seat_holds', showtimeId)) {
          throw new AppError(409, 'Không thể nạp lại khi suất diễn có vé hoặc ghế đang giữ.');
        }

        await trx('seats').where({ showtime_id: showtimeId }).del();
        await trx('seat_categories').where({ showtime_id: showtimeId }).del();

        const names = [...new Set(seats.map((seat) => seat.category))];
        const categories = await trx('seat_categories')
          .insert(names.map((name) => ({ showtime_id: showtimeId, name })))
          .returning(['id', 'name']);
        const categoryIds = new Map(categories.map((category) => [category.name, category.id]));

        // One multi-row INSERT, not one SQL statement per seat.
        await trx('seats').insert(seats.map((seat) => ({
          showtime_id: showtimeId,
          category_id: categoryIds.get(seat.category),
          row_label: seat.row,
          seat_number: seat.number,
        })));

        return { showtime_id: showtimeId, seats_count: seats.length, categories_count: names.length };
      });
    } catch (error) {
      if (['22001', '22003', '23505', '23514'].includes(error.code)) {
        throw new AppError(400, 'Dữ liệu ghế không hợp lệ.');
      }
      if (error.code === '23503') {
        throw new AppError(409, 'Không thể nạp lại khi ghế đang được sử dụng.');
      }
      throw error;
    }
  }

  return { importSeatMap };
}

module.exports = { createSeatMapService, parseSeatMap };
