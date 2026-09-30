(function seatMapCoreModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeatMapCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const STATUS = Object.freeze({
    AVAILABLE: 'AVAILABLE',
    HELD: 'HELD',
    SOLD: 'SOLD',
  });

  const STATUS_LABEL = Object.freeze({
    AVAILABLE: 'Trống',
    HELD: 'Đang có người giữ',
    SOLD: 'Đã bán',
  });

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeStatus(value) {
    const status = String(value || STATUS.AVAILABLE).toUpperCase();
    return Object.hasOwn(STATUS_LABEL, status) ? status : STATUS.AVAILABLE;
  }

  function normalizePayload(payload) {
    const source = payload && payload.data ? payload.data : payload;
    if (!source || !Array.isArray(source.seats)) {
      throw new Error('Dữ liệu sơ đồ ghế không hợp lệ.');
    }

    const rowOrderByLabel = new Map();
    let nextRowOrder = 1;
    const seats = source.seats.map((seat, index) => {
      const row = String(seat.row ?? seat.rowLabel ?? seat.row_label ?? '').trim();
      if (!rowOrderByLabel.has(row)) {
        rowOrderByLabel.set(row, nextRowOrder);
        nextRowOrder += 1;
      }
      const rowOrder = Number(seat.rowOrder ?? seat.row_order ?? rowOrderByLabel.get(row));
      const number = Number(seat.number ?? seat.seatNumber ?? seat.seat_number);
      const code = String(
        seat.code
        ?? seat.seatCode
        ?? seat.seat_code
        ?? `${row}-${String(number).padStart(3, '0')}`,
      );

      if (!row || !Number.isSafeInteger(rowOrder) || !Number.isSafeInteger(number)) {
        throw new Error(`Ghế thứ ${index + 1} thiếu hàng hoặc số ghế.`);
      }

      return {
        id: Number(seat.id ?? index + 1),
        code,
        row,
        rowOrder,
        number,
        categoryId: seat.categoryId ?? seat.category_id ?? null,
        category: seat.category ?? seat.categoryName ?? seat.category_name ?? null,
        status: normalizeStatus(seat.status),
      };
    });

    seats.sort((left, right) => left.rowOrder - right.rowOrder || left.number - right.number);
    return {
      showtime: source.showtime || null,
      generatedAt: source.generatedAt || null,
      seats,
    };
  }

  function decorateDemoStatuses(seats) {
    return seats.map((seat, index) => {
      if ((index + 1) % 29 === 0) return { ...seat, status: STATUS.SOLD };
      if ((index + 1) % 17 === 0) return { ...seat, status: STATUS.HELD };
      return { ...seat, status: STATUS.AVAILABLE };
    });
  }

  function buildLayout(seats, options = {}) {
    const seatSize = options.seatSize || 30;
    const gap = options.gap || 9;
    const left = options.left || 70;
    const top = options.top || 70;
    const rowGap = options.rowGap || 4;
    const rows = [...new Map(seats.map((seat) => [seat.rowOrder, seat.row])).entries()]
      .sort((leftRow, rightRow) => leftRow[0] - rightRow[0]);
    const rowIndex = new Map(rows.map(([order], index) => [order, index]));

    const positionedSeats = seats.map((seat) => ({
      ...seat,
      x: left + (seat.number - 1) * (seatSize + gap),
      y: top + rowIndex.get(seat.rowOrder) * (seatSize + gap + rowGap),
      width: seatSize,
      height: seatSize,
    }));

    const right = positionedSeats.reduce(
      (maximum, seat) => Math.max(maximum, seat.x + seat.width),
      left,
    );
    const bottom = positionedSeats.reduce(
      (maximum, seat) => Math.max(maximum, seat.y + seat.height),
      top,
    );
    return {
      seats: positionedSeats,
      rows,
      width: right + 50,
      height: bottom + 50,
      seatSize,
    };
  }

  function fitTransform(viewWidth, viewHeight, worldWidth, worldHeight, padding = 28) {
    const usableWidth = Math.max(1, viewWidth - padding * 2);
    const usableHeight = Math.max(1, viewHeight - padding * 2);
    const scale = clamp(
      Math.min(usableWidth / worldWidth, usableHeight / worldHeight),
      0.2,
      2.5,
    );
    return {
      scale,
      x: (viewWidth - worldWidth * scale) / 2,
      y: (viewHeight - worldHeight * scale) / 2,
    };
  }

  function screenToWorld(point, transform) {
    return {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale,
    };
  }

  function hitTest(positionedSeats, point, transform) {
    const world = screenToWorld(point, transform);
    return positionedSeats.find((seat) => (
      world.x >= seat.x
      && world.x <= seat.x + seat.width
      && world.y >= seat.y
      && world.y <= seat.y + seat.height
    )) || null;
  }

  function zoomAt(transform, factor, point) {
    const nextScale = clamp(transform.scale * factor, 0.2, 4);
    const world = screenToWorld(point, transform);
    return {
      scale: nextScale,
      x: point.x - world.x * nextScale,
      y: point.y - world.y * nextScale,
    };
  }

  function summarize(seats) {
    return seats.reduce((counts, seat) => {
      counts[seat.status] += 1;
      return counts;
    }, { AVAILABLE: 0, HELD: 0, SOLD: 0 });
  }

  function isSelectableSeat(seat) {
    return Boolean(seat) && normalizeStatus(seat.status) === STATUS.AVAILABLE;
  }

  return {
    STATUS,
    STATUS_LABEL,
    buildLayout,
    decorateDemoStatuses,
    fitTransform,
    hitTest,
    isSelectableSeat,
    normalizePayload,
    normalizeStatus,
    screenToWorld,
    summarize,
    zoomAt,
  };
}));
