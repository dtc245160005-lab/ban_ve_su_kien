const defaultDb = require('../db');

const DRAFT = 'draft';
const ON_SALE = 'on_sale';
const CLOSED = 'closed';
const ALL = [DRAFT, ON_SALE, CLOSED];

const ALLOWED_TRANSITIONS = {
  [DRAFT]: [ON_SALE],
  [ON_SALE]: [CLOSED],
  [CLOSED]: [ON_SALE],
};

function isValidTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

function assertCanManage(user, ownerId) {
  if (!user) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    err.status = 401;
    throw err;
  }

  const roles = Array.isArray(user.roles)
    ? user.roles
    : user.role
    ? [user.role]
    : [];

  const isAdmin = roles.includes('admin');
  const isOwner = Number(user.id) === Number(ownerId);

  if (!isAdmin && !isOwner) {
    const err = new Error('Forbidden: Permission denied');
    err.statusCode = 403;
    err.status = 403;
    throw err;
  }
}

async function changeShowtimeStatus(showtimeId, newStatus, user, customDb = null) {
  const db = customDb || defaultDb;

  if (!showtimeId) {
    const err = new Error('Showtime ID is required');
    err.statusCode = 400;
    err.status = 400;
    throw err;
  }

  if (!ALL.includes(newStatus)) {
    const err = new Error(`Invalid status: ${newStatus}`);
    err.statusCode = 409;
    err.status = 409;
    throw err;
  }

  return await db.transaction(async (trx) => {
    const showtime = await trx('showtimes')
      .join('events', 'showtimes.event_id', 'events.id')
      .select('showtimes.*', 'events.owner_id')
      .where('showtimes.id', showtimeId)
      .forUpdate()
      .first();

    if (!showtime) {
      const err = new Error('Showtime not found');
      err.statusCode = 404;
      err.status = 404;
      throw err;
    }

    assertCanManage(user, showtime.owner_id);

    if (!isValidTransition(showtime.status, newStatus)) {
      const err = new Error(`Cannot transition status from ${showtime.status} to ${newStatus}`);
      err.statusCode = 409;
      err.status = 409;
      throw err;
    }

    const seatStats = await trx('seats')
      .where({ showtime_id: showtimeId })
      .count('id as total_seats')
      .first();

    const totalSeats = seatStats ? Number(seatStats.total_seats) : 0;

    if (newStatus === ON_SALE && totalSeats === 0) {
      const err = new Error('Cannot open sale for showtime without seats');
      err.statusCode = 409;
      err.status = 409;
      throw err;
    }

    await trx('showtimes')
      .where({ id: showtimeId })
      .update({ status: newStatus });

    const updated = await trx('showtimes').where({ id: showtimeId }).first();

    return {
      ...updated,
      total_seats: totalSeats,
      seats_count: totalSeats,
    };
  });
}

const showtimeStatusService = {
  assertCanManage,
  changeShowtimeStatus,
  updateStatus: changeShowtimeStatus,
};

module.exports = {
  DRAFT,
  ON_SALE,
  CLOSED,
  ALL,
  changeShowtimeStatus,
  assertCanManage,
  showtimeStatusService,
  isValidTransition,
  ALLOWED_TRANSITIONS,
};
