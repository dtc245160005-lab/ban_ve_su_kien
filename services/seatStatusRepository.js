const defaultDb = require('../db');

function createSeatStatusRepository(customDb = defaultDb) {
  async function findSeatMapByShowtime(showtimeId) {
    /*
     * T-19 hot query: showtime metadata and every seat are returned by one SQL
     * statement. Active holds are pre-aggregated once and their expiry is
     * evaluated by PostgreSQL CURRENT_TIMESTAMP, so
     * correctness never depends on the cleanup job cadence or the app clock.
     * T-36 can replace is_sold when the tickets table is available.
     */
    const result = await customDb.raw(`
      WITH requested_showtime AS (
        SELECT
          showtimes.id,
          showtimes.event_id,
          showtimes.starts_at,
          showtimes.room_name,
          events.title AS event_title
        FROM showtimes
        JOIN events ON events.id = showtimes.event_id
        WHERE showtimes.id = ?
          AND events.status = 'published'
      ), ranked_seats AS (
        SELECT
          seats.id,
          seats.category_id,
          seats.row_label,
          DENSE_RANK() OVER (
            ORDER BY LOWER(seats.row_label), seats.row_label
          )::integer AS row_order,
          seats.seat_number,
          seat_categories.name AS category_name,
          active_holds.seat_id IS NOT NULL AS is_held,
          FALSE AS is_sold
        FROM seats
        JOIN seat_categories
          ON seat_categories.id = seats.category_id
          AND seat_categories.showtime_id = seats.showtime_id
        LEFT JOIN (
          SELECT DISTINCT seat_id
          FROM seat_holds
          WHERE order_id IS NOT NULL
            OR expires_at > CURRENT_TIMESTAMP
        ) AS active_holds ON active_holds.seat_id = seats.id
        WHERE seats.showtime_id = ?
      )
      SELECT
        requested_showtime.id AS showtime_id,
        requested_showtime.event_id,
        requested_showtime.event_title,
        requested_showtime.starts_at,
        requested_showtime.room_name,
        ranked_seats.id AS seat_id,
        ranked_seats.category_id,
        ranked_seats.category_name,
        ranked_seats.row_label,
        ranked_seats.row_order,
        ranked_seats.seat_number,
        CONCAT(
          ranked_seats.row_label,
          '-',
          LPAD(ranked_seats.seat_number::text, 3, '0')
        ) AS seat_code,
        ranked_seats.is_held,
        ranked_seats.is_sold
      FROM requested_showtime
      LEFT JOIN ranked_seats ON TRUE
      ORDER BY ranked_seats.row_order, ranked_seats.seat_number, ranked_seats.id
    `, [showtimeId, showtimeId]);

    const rows = result.rows || [];
    if (rows.length === 0) return null;

    const first = rows[0];
    return {
      showtime: {
        id: first.showtime_id,
        eventId: first.event_id,
        eventTitle: first.event_title,
        startsAt: first.starts_at,
        roomName: first.room_name,
      },
      seats: rows
        .filter((row) => row.seat_id !== null)
        .map((row) => ({
          id: row.seat_id,
          code: row.seat_code,
          row: row.row_label,
          rowOrder: row.row_order,
          number: row.seat_number,
          categoryId: row.category_id,
          category: row.category_name,
          isHeld: row.is_held,
          isSold: row.is_sold,
        })),
    };
  }

  return { findSeatMapByShowtime };
}

module.exports = { createSeatStatusRepository };
