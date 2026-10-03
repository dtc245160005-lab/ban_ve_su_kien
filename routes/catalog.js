const express = require('express');
const { secure } = require('../middleware/routeRegistry');
const { createPublicCatalogService } = require('../services/publicCatalogService');

function registerCatalogRoutes(router, options = {}) {
  const publicCatalogService =
    options.publicCatalogService ||
    createPublicCatalogService({
      db: options.db,
      redis: options.redis,
    });

  // GET /showtimes?cursor=&limit=
  secure(router, 'get', '/showtimes', 'public', async (req, res) => {
    try {
      const result = await publicCatalogService.listOnSaleShowtimes({
        cursor: req.query.cursor,
        limit: req.query.limit,
      });

      return res.status(200).json({
        success: true,
        data: result,
        items: result.items,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      console.error('Error fetching on-sale showtimes:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // GET /showtimes/:id
  secure(router, 'get', '/showtimes/:id', 'public', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id) || !Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy suất diễn.' });
      }

      const showtime = await publicCatalogService.getPublicShowtime(id);
      return res.status(200).json({
        success: true,
        data: showtime,
        ...showtime,
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      console.error('Error fetching public showtime detail:', err.message);
      return res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  return router;
}

function createPublicCatalogRouter(options = {}) {
  const router = express.Router();
  return registerCatalogRoutes(router, options);
}

module.exports = {
  registerCatalogRoutes,
  createPublicCatalogRouter,
};
