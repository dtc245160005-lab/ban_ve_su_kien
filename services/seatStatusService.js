const SEAT_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  SOLD: 'SOLD',
});

const ALLOWED_STATUSES = new Set(Object.values(SEAT_STATUS));

class SeatMapError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'SeatMapError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseShowtimeId(value) {
  const showtimeId = Number(value);
  if (!Number.isSafeInteger(showtimeId) || showtimeId < 1) {
    throw new SeatMapError('INVALID_SHOWTIME_ID', 'Mã suất diễn không hợp lệ.', 400);
  }
  return showtimeId;
}

function resolveSeatStatus(row) {
  if (row.isSold === true) return SEAT_STATUS.SOLD;
  if (row.isHeld === true) return SEAT_STATUS.HELD;

  const status = String(row.status || SEAT_STATUS.AVAILABLE).toUpperCase();
  if (!ALLOWED_STATUSES.has(status)) {
    throw new SeatMapError(
      'INVALID_SEAT_STATUS',
      `Trạng thái ghế không hợp lệ: ${status}`,
      500,
    );
  }
  return status;
}

function normalizeSeat(row) {
  const id = Number(row.id);
  const rowOrder = Number(row.rowOrder ?? row.row_order);
  const number = Number(row.number ?? row.seatNumber ?? row.seat_number);
  const rowLabel = String(row.row ?? row.rowLabel ?? row.row_label ?? '').trim();
  const code = String(row.code ?? row.seatCode ?? row.seat_code ?? '').trim();

  if (!Number.isSafeInteger(id) || id < 1
    || !Number.isSafeInteger(rowOrder) || rowOrder < 1
    || !Number.isSafeInteger(number) || number < 1
    || !rowLabel || !code) {
    throw new SeatMapError(
      'INVALID_SEAT_DATA',
      'Dữ liệu ghế không đúng hợp đồng T-19.',
      500,
    );
  }

  return {
    id,
    code,
    row: rowLabel,
    rowOrder,
    number,
    categoryId: row.categoryId ?? row.category_id ?? null,
    category: row.category ?? row.categoryName ?? row.category_name ?? null,
    status: resolveSeatStatus(row),
  };
}

function createSeatStatusService({ repository, now = () => new Date() }) {
  if (!repository || typeof repository.findSeatMapByShowtime !== 'function') {
    throw new TypeError('Seat status repository phải có findSeatMapByShowtime().');
  }

  async function getSeatMap(rawShowtimeId) {
    const showtimeId = parseShowtimeId(rawShowtimeId);
    const result = await repository.findSeatMapByShowtime(showtimeId);

    if (!result || !result.showtime) {
      throw new SeatMapError('SHOWTIME_NOT_FOUND', 'Không tìm thấy suất diễn.', 404);
    }

    const sourceSeats = Array.isArray(result.seats) ? result.seats : [];
    if (sourceSeats.length === 0) {
      throw new SeatMapError('SEAT_MAP_NOT_READY', 'Suất diễn chưa mở bán.', 409);
    }

    const seats = sourceSeats
      .map(normalizeSeat)
      .sort((left, right) => left.rowOrder - right.rowOrder || left.number - right.number);

    const summary = seats.reduce((counts, seat) => {
      counts[seat.status] += 1;
      return counts;
    }, { AVAILABLE: 0, HELD: 0, SOLD: 0 });

    return {
      showtime: {
        id: Number(result.showtime.id),
        eventId: Number(result.showtime.eventId ?? result.showtime.event_id),
        eventTitle: result.showtime.eventTitle ?? result.showtime.event_title ?? null,
        startsAt: result.showtime.startsAt ?? result.showtime.starts_at ?? null,
        roomName: result.showtime.roomName ?? result.showtime.room_name ?? null,
      },
      generatedAt: now().toISOString(),
      seats,
      summary,
    };
  }

  return { getSeatMap };
}

module.exports = {
  SEAT_STATUS,
  SeatMapError,
  createSeatStatusService,
  normalizeSeat,
  parseShowtimeId,
  resolveSeatStatus,
};
