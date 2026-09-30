const defaultDb = require('../db');
const { validateEventForm, validateShowtimeForm } = require('../public/eventForm');

class AppError extends Error {
  constructor(status, message, errors = null, warnings = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.errors = errors;
    this.warnings = warnings;
  }
}

function assertCanManage(user, event) {
  if (!event) {
    throw new AppError(404, 'Sự kiện không tồn tại.');
  }

  if (!user) {
    throw new AppError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }

  const roles = Array.isArray(user.roles) ? user.roles : [];
  const isAdmin = roles.includes('admin');
  const isOwner = Number(event.owner_id) === Number(user.id);

  if (!isAdmin && !isOwner) {
    throw new AppError(403, 'Bạn không có quyền quản lý sự kiện này.');
  }
}

function createEventService(customDb) {
  const db = customDb || defaultDb;

  async function listPublicEvents() {
    return await db('events')
      .where({ status: 'published' })
      .select('id', 'title', 'description', 'venue')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
  }

  async function listOrganizerEvents(user) {
    if (!user) {
      throw new AppError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];
    const isAdmin = roles.includes('admin');

    let query = db('events')
      .leftJoin('showtimes', 'events.id', 'showtimes.event_id')
      .select(
        'events.id',
        'events.title',
        'events.description',
        'events.venue',
        'events.status',
        'events.owner_id',
        'events.created_at',
        'events.updated_at',
        db.raw('COUNT(showtimes.id)::integer as showtimes_count')
      )
      .groupBy('events.id')
      .orderBy('events.created_at', 'desc')
      .orderBy('events.id', 'desc');

    if (!isAdmin) {
      query = query.where('events.owner_id', user.id);
    }

    const events = await query;
    return events.map((e) => ({
      ...e,
      showtimes_count: Number(e.showtimes_count || 0),
    }));
  }

  async function getOrganizerEventById(id, user) {
    const event = await db('events').where({ id }).first();
    assertCanManage(user, event);

    const showtimes = await db('showtimes')
      .select('showtimes.*')
      .select(db.raw(`(
        SELECT COUNT(*)::integer
        FROM seats
        WHERE seats.showtime_id = showtimes.id
      ) AS seat_count`))
      .where({ event_id: id })
      .orderBy('starts_at', 'asc')
      .orderBy('id', 'asc');

    return {
      ...event,
      showtimes,
    };
  }

  async function createEvent(body, user) {
    if (!user) {
      throw new AppError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    const validation = validateEventForm(body);
    if (!validation.valid) {
      throw new AppError(400, 'Dữ liệu sự kiện không hợp lệ.', validation.errors);
    }

    const title = String(body.title).trim();
    const venue = String(body.venue).trim();
    const description = body.description ? String(body.description).trim() : null;

    const [newEvent] = await db('events')
      .insert({
        title,
        description,
        venue,
        status: 'draft',
        owner_id: user.id,
      })
      .returning('*');

    return newEvent;
  }

  async function updateEvent(id, body, user) {
    const event = await db('events').where({ id }).first();
    assertCanManage(user, event);

    const validation = validateEventForm(body);
    if (!validation.valid) {
      throw new AppError(400, 'Dữ liệu sự kiện không hợp lệ.', validation.errors);
    }

    const title = String(body.title).trim();
    const venue = String(body.venue).trim();
    const description = body.description ? String(body.description).trim() : null;

    // Không cho phép sửa owner_id hoặc status qua API này
    const [updated] = await db('events')
      .where({ id })
      .update({
        title,
        venue,
        description,
        updated_at: db.fn.now(),
      })
      .returning('*');

    return updated;
  }

  async function deleteEvent(id, user) {
    const event = await db('events').where({ id }).first();
    assertCanManage(user, event);

    const [{ count }] = await db('showtimes').where({ event_id: id }).count('* as count');
    if (Number(count) > 0) {
      throw new AppError(409, 'Không thể xoá sự kiện khi còn suất diễn.');
    }

    await db('events').where({ id }).del();
    return true;
  }

  async function createShowtime(eventId, body, user, now = new Date()) {
    const event = await db('events').where({ id: eventId }).first();
    assertCanManage(user, event);

    const validation = validateShowtimeForm(body, now);
    if (!validation.valid) {
      throw new AppError(400, 'Dữ liệu suất diễn không hợp lệ.', validation.errors);
    }

    const rawStartsAt = body?.starts_at !== undefined ? body.starts_at : body?.startsAt;
    const rawRoomName = body?.room_name !== undefined ? body.room_name : body?.roomName;
    const startsAtDate = new Date(String(rawStartsAt).trim());
    const roomName = rawRoomName ? String(rawRoomName).trim() : null;

    // Kiểm tra suất diễn trùng hoàn toàn thời điểm của cùng sự kiện
    const duplicateShowtimes = await db('showtimes')
      .where({
        event_id: eventId,
        starts_at: startsAtDate,
      })
      .select('id', 'room_name');

    const warnings = [];
    if (duplicateShowtimes.length > 0) {
      for (const dup of duplicateShowtimes) {
        const roomInfo = dup.room_name ? ` (${dup.room_name})` : '';
        warnings.push(`Trùng thời điểm với suất diễn #${dup.id}${roomInfo}`);
      }
    }

    const [newShowtime] = await db('showtimes')
      .insert({
        event_id: eventId,
        starts_at: startsAtDate,
        room_name: roomName,
      })
      .returning('*');

    return {
      showtime: newShowtime,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async function updateShowtime(showtimeId, body, user, now = new Date()) {
    const showtime = await db('showtimes').where({ id: showtimeId }).first();
    if (!showtime) {
      throw new AppError(404, 'Suất diễn không tồn tại.');
    }

    const event = await db('events').where({ id: showtime.event_id }).first();
    assertCanManage(user, event);

    const validation = validateShowtimeForm(body, now);
    if (!validation.valid) {
      throw new AppError(400, 'Dữ liệu suất diễn không hợp lệ.', validation.errors);
    }

    const rawStartsAt = body?.starts_at !== undefined ? body.starts_at : body?.startsAt;
    const rawRoomName = body?.room_name !== undefined ? body.room_name : body?.roomName;
    const startsAtDate = new Date(String(rawStartsAt).trim());
    const roomName = rawRoomName ? String(rawRoomName).trim() : null;

    // Kiểm tra trùng thời điểm với các suất diễn khác của cùng sự kiện (ngoại trừ chính nó)
    const duplicateShowtimes = await db('showtimes')
      .where({
        event_id: showtime.event_id,
        starts_at: startsAtDate,
      })
      .whereNot({ id: showtimeId })
      .select('id', 'room_name');

    const warnings = [];
    if (duplicateShowtimes.length > 0) {
      for (const dup of duplicateShowtimes) {
        const roomInfo = dup.room_name ? ` (${dup.room_name})` : '';
        warnings.push(`Trùng thời điểm với suất diễn #${dup.id}${roomInfo}`);
      }
    }

    const [updatedShowtime] = await db('showtimes')
      .where({ id: showtimeId })
      .update({
        starts_at: startsAtDate,
        room_name: roomName,
        updated_at: db.fn.now(),
      })
      .returning('*');

    return {
      showtime: updatedShowtime,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async function deleteShowtime(showtimeId, user) {
    const showtime = await db('showtimes').where({ id: showtimeId }).first();
    if (!showtime) {
      throw new AppError(404, 'Suất diễn không tồn tại.');
    }

    const event = await db('events').where({ id: showtime.event_id }).first();
    assertCanManage(user, event);

    await db('showtimes').where({ id: showtimeId }).del();
    return true;
  }

  return {
    assertCanManage,
    listPublicEvents,
    listOrganizerEvents,
    getOrganizerEventById,
    createEvent,
    updateEvent,
    deleteEvent,
    createShowtime,
    updateShowtime,
    deleteShowtime,
  };
}

const defaultEventService = createEventService();
defaultEventService.createEventService = createEventService;
defaultEventService.AppError = AppError;
defaultEventService.assertCanManage = assertCanManage;

module.exports = defaultEventService;
