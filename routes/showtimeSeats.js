const express = require('express');
const { secure } = require('../middleware/routeRegistry');
const { SeatMapError } = require('../services/seatStatusService');

function createShowtimeSeatsRouter({ seatStatusService }) {
  if (!seatStatusService || typeof seatStatusService.getSeatMap !== 'function') {
    throw new TypeError('Thiếu seatStatusService cho route T-19.');
  }

  const router = express.Router();

  secure(router, 'get', '/:showtimeId/seats', 'authenticated', async (req, res, next) => {
    try {
      const data = await seatStatusService.getSeatMap(req.params.showtimeId);
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof SeatMapError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = { createShowtimeSeatsRouter };
