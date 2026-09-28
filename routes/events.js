const express = require('express');
const defaultEventService = require('../services/eventService');
const { secure } = require('../middleware/routeRegistry');
const { logEvent } = require('../lib/logger');

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

  // 8. DELETE /api/organizer/showtimes/:id
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

  return router;
}

const defaultPublicEventsRouter = createPublicEventsRouter();
defaultPublicEventsRouter.createPublicEventsRouter = createPublicEventsRouter;
defaultPublicEventsRouter.createOrganizerEventsRouter = createOrganizerEventsRouter;

module.exports = defaultPublicEventsRouter;
