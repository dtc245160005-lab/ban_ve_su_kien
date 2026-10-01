const express = require('express');
const multer = require('multer');
const defaultEventService = require('../services/eventService');
const { createSeatMapService } = require('../services/seatMapService');
const { changeShowtimeStatus } = require('../services/showtimeStatusService');
const { secure } = require('../middleware/routeRegistry');
const { logEvent } = require('../lib/logger');

const receiveSeatMap = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single('file');

function receiveSeatMapFile(req, res, next) {
  if (!req.is('multipart/form-data')) {
    return res.status(415).json({ success: false, message: 'Cần gửi tệp JSON dạng multipart/form-data.' });
  }
  return receiveSeatMap(req, res, (error) => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: 'Tệp tải lên không hợp lệ hoặc vượt quá 5 MB.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Thiếu tệp JSON ở trường file.' });
    }
    return next();
  });
}

function createPublicEventsRouter(options = {}) {
  const router = express.Router();
  const eventService = options.eventService || defaultEventService.createEventService(options.db);

  secure(router, 'get', '/', 'public', async (_req, res) => {
    try {
      const events = await eventService.listPublicEvents();
      return res.status(200).json({ success: true, data: events });
    } catch (err) {
      console.error('Error fetching public events:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  return router;
}

function createOrganizerEventsRouter(options = {}) {
  const router = express.Router();
  const eventService = options.eventService || defaultEventService.createEventService(options.db);
  const allowedRoles = { roles: ['organizer', 'admin'] };
  const seatMapService = options.seatMapService || createSeatMapService(options.db);

  // 1. GET /api/organizer/events
  secure(router, 'get', '/events', allowedRoles, async (req, res) => {
    try {
      const events = await eventService.listOrganizerEvents(req.user);
      return res.status(200).json({ success: true, data: events });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error listing organizer events:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 2. POST /api/organizer/events
  secure(router, 'post', '/events', allowedRoles, async (req, res) => {
    try {
      const event = await eventService.createEvent(req.body, req.user);
      logEvent('event_created', { userId: req.user?.id });
      return res.status(201).json({ success: true, data: event });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error creating event:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 3. GET /api/organizer/events/:id
  secure(router, 'get', '/events/:id', allowedRoles, async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      if (Number.isNaN(eventId)) {
        return res.status(404).json({ success: false, message: 'Sự kiện không tồn tại.' });
      }
      const event = await eventService.getOrganizerEventById(eventId, req.user);
      return res.status(200).json({ success: true, data: event });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error getting organizer event:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 4. PUT /api/organizer/events/:id
  secure(router, 'put', '/events/:id', allowedRoles, async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      if (Number.isNaN(eventId)) {
        return res.status(404).json({ success: false, message: 'Sự kiện không tồn tại.' });
      }
      const updated = await eventService.updateEvent(eventId, req.body, req.user);
      logEvent('event_updated', { userId: req.user?.id });
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error updating event:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 5. DELETE /api/organizer/events/:id
  secure(router, 'delete', '/events/:id', allowedRoles, async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      if (Number.isNaN(eventId)) {
        return res.status(404).json({ success: false, message: 'Sự kiện không tồn tại.' });
      }
      await eventService.deleteEvent(eventId, req.user);
      logEvent('event_deleted', { userId: req.user?.id });
      return res.status(200).json({ success: true, message: 'Đã xoá sự kiện thành công.' });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error deleting event:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 6. POST /api/organizer/events/:id/showtimes
  secure(router, 'post', '/events/:id/showtimes', allowedRoles, async (req, res) => {
    try {
      const eventId = Number(req.params.id);
      if (Number.isNaN(eventId)) {
        return res.status(404).json({ success: false, message: 'Sự kiện không tồn tại.' });
      }
      const result = await eventService.createShowtime(eventId, req.body, req.user);
      logEvent('showtime_created', { userId: req.user?.id });
      const responseBody = {
        success: true,
        data: result.showtime,
      };
      if (result.warnings) {
        responseBody.warnings = result.warnings;
      }
      return res.status(201).json(responseBody);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error creating showtime:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 7. PUT /api/organizer/showtimes/:id
  secure(router, 'put', '/showtimes/:id', allowedRoles, async (req, res) => {
    try {
      const showtimeId = Number(req.params.id);
      if (Number.isNaN(showtimeId)) {
        return res.status(404).json({ success: false, message: 'Suất diễn không tồn tại.' });
      }
      const result = await eventService.updateShowtime(showtimeId, req.body, req.user);
      const responseBody = {
        success: true,
        data: result.showtime,
      };
      if (result.warnings) {
        responseBody.warnings = result.warnings;
      }
      return res.status(200).json(responseBody);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error updating showtime:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 8. POST /api/organizer/showtimes/:id/status
  secure(router, 'post', '/showtimes/:id/status', allowedRoles, async (req, res) => {
    try {
      const showtimeId = Number(req.params.id);
      if (!Number.isSafeInteger(showtimeId) || showtimeId <= 0) {
        return res.status(404).json({ success: false, message: 'Suất diễn không tồn tại.' });
      }

      const result = await changeShowtimeStatus(showtimeId, req.body?.status, req.user, options.db);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || err.status;
      if (status) {
        return res.status(status).json({ success: false, message: err.message, error: err.message, errors: err.errors });
      }
      console.error('Error changing showtime status:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // 9. DELETE /api/organizer/showtimes/:id
  secure(router, 'delete', '/showtimes/:id', allowedRoles, async (req, res) => {
    try {
      const showtimeId = Number(req.params.id);
      if (Number.isNaN(showtimeId)) {
        return res.status(404).json({ success: false, message: 'Suất diễn không tồn tại.' });
      }
      await eventService.deleteShowtime(showtimeId, req.user);
      logEvent('showtime_deleted', { userId: req.user?.id });
      return res.status(200).json({ success: true, message: 'Đã xoá suất diễn thành công.' });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
      }
      console.error('Error deleting showtime:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // T-12: replace the entire seat map atomically; file field is named `file`.
  secure(router, 'post', '/showtimes/:id/seats/import', allowedRoles, receiveSeatMapFile, async (req, res) => {
    try {
      const result = await seatMapService.importSeatMap(Number(req.params.id), req.file.buffer, req.user);
      logEvent('seat_map_imported', { userId: req.user?.id, showtimeId: result.showtime_id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.status) {
        const body = { success: false, message: error.message };
        if (error.errors) {
          body.errors = error.errors;
        }
        if (error.truncated !== undefined) {
          body.truncated = error.truncated;
        }
        return res.status(error.status).json(body);
      }
      console.error('Error importing seat map:', error.code || 'unexpected error');
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  return router;
}

const defaultPublicEventsRouter = createPublicEventsRouter();
defaultPublicEventsRouter.createPublicEventsRouter = createPublicEventsRouter;
defaultPublicEventsRouter.createOrganizerEventsRouter = createOrganizerEventsRouter;

module.exports = defaultPublicEventsRouter;