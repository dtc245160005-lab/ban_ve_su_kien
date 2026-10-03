const defaultDb = require('../db');
const { redisClient: defaultRedisClient } = require('../lib/redis');

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

// Giới hạn kiểu integer của PostgreSQL; id lớn hơn sẽ làm truy vấn lỗi 500.
const MAX_DB_INTEGER = 2147483647;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

function isDbId(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_DB_INTEGER;
}

function parseCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') {
    return null;
  }

  try {
    // Buffer.from bỏ qua ký tự lạ, nên phải kiểm tra bảng chữ base64url và mã hoá lại để so khớp.
    if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor)) {
      throw new Error();
    }
    const buffer = Buffer.from(cursor, 'base64url');
    if (buffer.toString('base64url') !== cursor) {
      throw new Error();
    }
    const raw = buffer.toString('utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }

    if (typeof parsed.s !== 'string' || !parsed.s.trim()) {
      throw new Error();
    }

    const timeMs = Date.parse(parsed.s);
    if (Number.isNaN(timeMs)) {
      throw new Error();
    }

    const id = parsed.i;
    if (!isDbId(id)) {
      throw new Error();
    }

    return {
      startsAtIso: new Date(timeMs).toISOString(),
      id,
    };
  } catch {
    throw new AppError(400, 'Con trỏ phân trang (cursor) không hợp lệ.');
  }
}

function createPublicCatalogService(options = {}) {
  const db = options.db || defaultDb;
  // If redis is explicitly passed (even null or mock), use it; otherwise default to defaultRedisClient
  const redis = options.redis !== undefined ? options.redis : defaultRedisClient;
  // Dùng chung tiền tố khoá với redisAuthStore để các môi trường chung Redis không trộn cache.
  const keyPrefix = options.keyPrefix !== undefined
    ? options.keyPrefix
    : process.env.REDIS_KEY_PREFIX !== undefined ? process.env.REDIS_KEY_PREFIX : 'bvsk:';

  async function listOnSaleShowtimes({ cursor, limit } = {}) {
    const cursorData = parseCursor(cursor);

    let parsedLimit = 20;
    if (limit !== undefined && limit !== null && limit !== '') {
      const num = Number(limit);
      if (!Number.isNaN(num) && num > 0) {
        parsedLimit = Math.min(Math.floor(num), 50);
      }
    }

    const cacheCursor = cursorData ? cursor : 'first';
    const cacheKey = `${keyPrefix}catalog:onsale:v1:${cacheCursor}:${parsedLimit}`;

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
          return parsed;
        }
      } catch {
        // Ignore Redis read error and fallback to DB query
      }
    }

    const query = db('showtimes')
      .innerJoin('events', 'showtimes.event_id', 'events.id')
      .where('showtimes.status', 'on_sale')
      .where('events.status', 'published')
      .where('showtimes.starts_at', '>', db.fn.now());

    if (cursorData) {
      query.whereRaw('(showtimes.starts_at, showtimes.id) > (?::timestamptz, ?::integer)', [
        cursorData.startsAtIso,
        cursorData.id,
      ]);
    }

    query
      .select(
        'showtimes.id',
        'showtimes.event_id',
        'showtimes.room_name',
        'showtimes.starts_at',
        'events.title',
        'events.description',
        'events.venue'
      )
      .orderBy('showtimes.starts_at', 'asc')
      .orderBy('showtimes.id', 'asc')
      .limit(parsedLimit + 1);

    const rows = await query;
    const hasMore = rows.length > parsedLimit;
    const itemsToReturn = hasMore ? rows.slice(0, parsedLimit) : rows;

    let nextCursor = null;
    if (hasMore && itemsToReturn.length > 0) {
      const last = itemsToReturn[itemsToReturn.length - 1];
      const payload = {
        s: new Date(last.starts_at).toISOString(),
        i: Number(last.id),
      };
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64url');
    }

    const items = itemsToReturn.map((row) => ({
      showtimeId: Number(row.id),
      eventId: Number(row.event_id),
      title: row.title,
      description: row.description,
      venue: row.venue,
      roomName: row.room_name,
      startsAt: new Date(row.starts_at).toISOString(),
      minPrice: null,
      maxPrice: null,
    }));

    const result = {
      items,
      nextCursor,
    };

    if (redis) {
      try {
        if (typeof redis.set === 'function') {
          const p = redis.set(cacheKey, JSON.stringify(result), { EX: 30 });
          if (p && typeof p.catch === 'function') {
            await p.catch(() => {});
          }
        }
      } catch {
        // Ignore Redis write error
      }
    }

    return result;
  }

  async function getPublicShowtime(id) {
    const showtimeId = Number(id);
    if (!isDbId(showtimeId)) {
      throw new AppError(404, 'Không tìm thấy suất diễn.');
    }

    const row = await db('showtimes')
      .innerJoin('events', 'showtimes.event_id', 'events.id')
      .where('showtimes.id', showtimeId)
      .select(
        'showtimes.id',
        'showtimes.event_id',
        'showtimes.room_name',
        'showtimes.starts_at',
        'showtimes.status as showtime_status',
        'events.title',
        'events.description',
        'events.venue',
        'events.status as event_status',
        db.raw(`(
          SELECT COUNT(*)::integer
          FROM seats
          WHERE seats.showtime_id = showtimes.id
        ) AS seat_count`)
      )
      .first();

    if (!row || row.event_status !== 'published') {
      throw new AppError(404, 'Không tìm thấy suất diễn.');
    }

    const onSale = row.showtime_status === 'on_sale';

    return {
      showtimeId: Number(row.id),
      eventId: Number(row.event_id),
      title: row.title,
      description: row.description,
      venue: row.venue,
      roomName: row.room_name,
      startsAt: new Date(row.starts_at).toISOString(),
      minPrice: null,
      maxPrice: null,
      seatCount: Number(row.seat_count || 0),
      onSale,
    };
  }

  return {
    listOnSaleShowtimes,
    getPublicShowtime,
  };
}

module.exports = {
  AppError,
  parseCursor,
  createPublicCatalogService,
};
