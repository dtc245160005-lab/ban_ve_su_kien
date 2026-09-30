(() => {
  const Core = window.SeatMapCore;
  const canvas = document.getElementById('seatCanvas');
  const viewport = document.getElementById('canvasViewport');
  const context = canvas.getContext('2d');
  const message = document.getElementById('message');
  const sourceText = document.getElementById('sourceText');
  const showtimeText = document.getElementById('showtimeText');
  const seatSummary = document.getElementById('seatSummary');
  const selectedSeat = document.getElementById('selectedSeat');
  const renderTiming = document.getElementById('renderTiming');
  const liveRegion = document.getElementById('liveRegion');
  const pointers = new Map();
  const pointerStarts = new Map();

  let layout = { seats: [], rows: [], width: 1, height: 1 };
  let transform = { scale: 1, x: 0, y: 0 };
  let drawQueued = false;
  let firstRenderRecorded = false;
  let selectedIndex = -1;
  let previousPinch = null;

  const palette = {
    AVAILABLE: { fill: '#d9f5e4', stroke: '#2c8555', symbol: '○' },
    HELD: { fill: '#fff0bd', stroke: '#9b7900', symbol: '╱' },
    SOLD: { fill: '#e4e8ef', stroke: '#6c7482', symbol: '×' },
  };

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function showError(text) {
    message.hidden = false;
    message.textContent = text;
    liveRegion.textContent = text;
  }

  function clearError() {
    message.hidden = true;
    message.textContent = '';
  }

  function resizeCanvas() {
    const bounds = viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    canvas.style.width = `${bounds.width}px`;
    canvas.style.height = `${bounds.height}px`;
    requestDraw();
  }

  function resetView() {
    const bounds = viewport.getBoundingClientRect();
    transform = Core.fitTransform(bounds.width, bounds.height, layout.width, layout.height);
    requestDraw();
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
    else ctx.rect(x, y, width, height);
  }

  function drawStage() {
    const width = Math.min(620, Math.max(120, layout.width - 140));
    context.fillStyle = '#dfe8f8';
    roundedRect(context, (layout.width - width) / 2, 13, width, 28, 8);
    context.fill();
    context.fillStyle = '#53627a';
    context.font = '700 12px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('SÂN KHẤU', layout.width / 2, 27);
  }

  function drawSeat(seat, index) {
    const style = palette[seat.status];
    const isSelected = index === selectedIndex;
    context.fillStyle = style.fill;
    context.strokeStyle = isSelected ? '#2459d3' : style.stroke;
    context.lineWidth = isSelected ? 3 / transform.scale : 1 / transform.scale;
    roundedRect(context, seat.x, seat.y, seat.width, seat.height, 6);
    context.fill();
    context.stroke();
    context.fillStyle = style.stroke;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${Math.max(12, 16 / Math.sqrt(transform.scale))}px system-ui, sans-serif`;
    context.fillText(style.symbol, seat.x + seat.width / 2, seat.y + seat.height / 2 + 1);
  }

  function draw() {
    drawQueued = false;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.scale, transform.scale);
    drawStage();
    context.font = '700 12px system-ui, sans-serif';
    context.fillStyle = '#65738b';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    layout.rows.forEach(([order, label]) => {
      const firstSeat = layout.seats.find((seat) => seat.rowOrder === order);
      if (firstSeat) context.fillText(label, 57, firstSeat.y + firstSeat.height / 2);
    });
    layout.seats.forEach(drawSeat);
    context.restore();

    if (!firstRenderRecorded && layout.seats.length) {
      firstRenderRecorded = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        performance.mark('seat-map-render-complete');
        performance.measure('seat-map-total', 'seat-map-load-start', 'seat-map-render-complete');
        const measure = performance.getEntriesByName('seat-map-total').at(-1);
        const durationMs = Math.round(measure.duration * 10) / 10;
        renderTiming.textContent = `Hiển thị ${layout.seats.length.toLocaleString('vi-VN')} ghế: ${durationMs} ms`;
        window.__seatMapMetrics = { durationMs, seatCount: layout.seats.length };
        window.parent.postMessage({
          type: 'seat-map-rendered',
          durationMs,
          seatCount: layout.seats.length,
        }, '*');
      }));
    }
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  }

  function updateSummary() {
    const summary = Core.summarize(layout.seats);
    seatSummary.textContent = `${layout.seats.length.toLocaleString('vi-VN')} ghế · ${summary.AVAILABLE.toLocaleString('vi-VN')} trống · ${summary.HELD.toLocaleString('vi-VN')} đang giữ · ${summary.SOLD.toLocaleString('vi-VN')} đã bán`;
  }

  function announceSeat(seat) {
    const label = Core.STATUS_LABEL[seat.status];
    if (seat.status !== Core.STATUS.AVAILABLE) {
      selectedSeat.textContent = `${seat.code}: ${label}. Không thể chọn.`;
      liveRegion.textContent = selectedSeat.textContent;
      return false;
    }
    selectedSeat.textContent = `Đã chọn ${seat.code} · ${seat.category || 'Chưa phân hạng'}`;
    liveRegion.textContent = selectedSeat.textContent;
    return true;
  }

  function selectAt(point) {
    const seat = Core.hitTest(layout.seats, point, transform);
    // Ghế đang giữ hoặc đã bán không làm thay đổi lựa chọn hiện tại.
    if (!Core.isSelectableSeat(seat)) return;
    selectedIndex = layout.seats.findIndex((item) => item.id === seat.id);
    announceSeat(seat);
    requestDraw();
  }

  function zoom(factor, point = null) {
    const bounds = canvas.getBoundingClientRect();
    const focus = point || { x: bounds.width / 2, y: bounds.height / 2 };
    transform = Core.zoomAt(transform, factor, focus);
    requestDraw();
  }

  function pointerDistance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
  }

  function pointerCenter(left, right) {
    return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    pointerStarts.set(event.pointerId, point);
    if (pointers.size === 2) {
      const [left, right] = [...pointers.values()];
      previousPinch = { distance: pointerDistance(left, right), center: pointerCenter(left, right) };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const current = canvasPoint(event);
    pointers.set(event.pointerId, current);

    if (pointers.size === 2) {
      const [left, right] = [...pointers.values()];
      const next = { distance: pointerDistance(left, right), center: pointerCenter(left, right) };
      if (previousPinch && previousPinch.distance > 0) {
        transform = Core.zoomAt(transform, next.distance / previousPinch.distance, next.center);
        transform.x += next.center.x - previousPinch.center.x;
        transform.y += next.center.y - previousPinch.center.y;
      }
      previousPinch = next;
    } else {
      transform.x += current.x - previous.x;
      transform.y += current.y - previous.y;
    }
    requestDraw();
  });

  function finishPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const end = canvasPoint(event);
    const start = pointerStarts.get(event.pointerId);
    const wasClick = pointers.size === 1 && start && pointerDistance(start, end) < 6;
    pointers.delete(event.pointerId);
    pointerStarts.delete(event.pointerId);
    previousPinch = null;
    if (wasClick) selectAt(end);
  }

  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 0.89, canvasPoint(event));
  }, { passive: false });
  document.getElementById('zoomIn').addEventListener('click', () => zoom(1.2));
  document.getElementById('zoomOut').addEventListener('click', () => zoom(0.82));
  document.getElementById('resetView').addEventListener('click', resetView);
  new ResizeObserver(resizeCanvas).observe(viewport);

  async function fetchJson(url) {
    const response = await window.apiFetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || 'Không tải được sơ đồ ghế.');
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  async function load() {
    clearError();
    const params = new URLSearchParams(window.location.search);
    const showtimeId = Number(params.get('showtime'));
    const isDemo = !Number.isSafeInteger(showtimeId) || showtimeId < 1 || params.get('demo') === '1';

    try {
      const payload = await fetchJson(
        isDemo ? '/data/seat-map-2000.json' : `/api/showtimes/${showtimeId}/seats`,
      );
      const normalized = Core.normalizePayload(payload);
      const seats = isDemo ? Core.decorateDemoStatuses(normalized.seats) : normalized.seats;
      layout = Core.buildLayout(seats);
      sourceText.textContent = isDemo
        ? 'Dữ liệu mẫu T-21 · kéo để di chuyển, cuộn hoặc chụm để phóng to'
        : 'Dữ liệu trực tiếp từ API T-19';
      showtimeText.textContent = normalized.showtime
        ? `${normalized.showtime.eventTitle || 'Sự kiện'} · ${normalized.showtime.roomName || 'Chưa có phòng'}`
        : 'Bản xem trước với 2.000 ghế mẫu';
      updateSummary();
      resizeCanvas();
      resetView();
    } catch (error) {
      showError(error.code === 'SEAT_MAP_NOT_READY' ? 'Suất diễn chưa mở bán.' : error.message);
      sourceText.textContent = 'Không có dữ liệu để hiển thị.';
    }
  }

  load();
})();
