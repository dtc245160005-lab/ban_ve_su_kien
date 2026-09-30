const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSeatStatusService, SeatMapError } = require('../services/seatStatusService');
const { createShowtimeSeatsRouter } = require('../routes/showtimeSeats');

function seat(id, rowOrder, number, overrides = {}) {
  return {
    id,
    code: `R${String(rowOrder).padStart(2, '0')}-${String(number).padStart(3, '0')}`,
    row: `R${String(rowOrder).padStart(2, '0')}`,
    rowOrder,
    number,
    category: 'Phổ thông',
    ...overrides,
  };
}

function fixture(overrides = {}) {
  let calls = 0;
  const result = {
    showtime: {
      id: 7,
      eventId: 3,
      eventTitle: 'Đêm nhạc',
      startsAt: '2026-10-01T12:00:00.000Z',
      roomName: 'Phòng A',
    },
    seats: [
      seat(3, 2, 1, { status: 'AVAILABLE' }),
      seat(1, 1, 2, { isHeld: true }),
      seat(2, 1, 1, { isHeld: true, isSold: true }),
    ],
    ...overrides,
  };
  const repository = {
    async findSeatMapByShowtime(showtimeId) {
      calls += 1;
      assert.equal(showtimeId, 7);
      return result;
    },
  };
  return {
    service: createSeatStatusService({
      repository,
      now: () => new Date('2026-09-27T00:00:00.000Z'),
    }),
    getCalls: () => calls,
  };
}

test('T-19 chuẩn hóa đúng ba trạng thái và ưu tiên SOLD > HELD > AVAILABLE', async () => {
  const { service, getCalls } = fixture();
  const result = await service.getSeatMap('7');

  assert.equal(getCalls(), 1);
  assert.deepEqual(result.seats.map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(result.seats.map((item) => item.status), ['SOLD', 'HELD', 'AVAILABLE']);
  assert.deepEqual(result.summary, { AVAILABLE: 1, HELD: 1, SOLD: 1 });
  assert.equal(result.generatedAt, '2026-09-27T00:00:00.000Z');
  assert.equal('heldBy' in result.seats[1], false);
});

test('T-19 trả lỗi nghiệp vụ khi suất diễn chưa có sơ đồ', async () => {
  const { service } = fixture({ seats: [] });
  await assert.rejects(
    () => service.getSeatMap(7),
    (error) => error instanceof SeatMapError
      && error.code === 'SEAT_MAP_NOT_READY'
      && error.statusCode === 409,
  );
});

test('T-19 xử lý 2.000 ghế qua đúng một lần gọi repository', async () => {
  const seats = Array.from({ length: 2000 }, (_, index) => {
    const rowOrder = Math.floor(index / 50) + 1;
    return seat(index + 1, rowOrder, (index % 50) + 1);
  });
  const { service, getCalls } = fixture({ seats });
  const result = await service.getSeatMap(7);

  assert.equal(result.seats.length, 2000);
  assert.equal(getCalls(), 1);
  assert.equal(result.seats[0].code, 'R01-001');
  assert.equal(result.seats.at(-1).code, 'R40-050');
});

test('route T-19 yêu cầu đăng nhập và giữ đúng hợp đồng JSON', async (t) => {
  const { service } = fixture();
  const app = express();
  app.locals.sessionStore = {
    async get(token) {
      return token === 'valid' ? { userId: 11, roles: ['buyer'] } : null;
    },
  };
  app.use('/api/showtimes', createShowtimeSeatsRouter({ seatStatusService: service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const anonymous = await fetch(`${baseUrl}/api/showtimes/7/seats`);
  assert.equal(anonymous.status, 401);

  const response = await fetch(`${baseUrl}/api/showtimes/7/seats`, {
    headers: { cookie: 'session_token=valid' },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.showtime.id, 7);
  assert.equal(body.data.seats.length, 3);
});
