// Cấu hình test
const API_URL = process.env.API_URL || 'http://localhost:8090/api/seat-holds';
const CONCURRENT_REQUESTS = 200;
const SEATS_COUNT = 100;

async function runTest() {
  console.log(`Bắt đầu kịch bản kiểm thử T-31: Bắn ${CONCURRENT_REQUESTS} yêu cầu vào ${SEATS_COUNT} ghế...`);
  
  const requests = [];
  
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    // Chỉ có 100 ghế (từ S1 đến S100), nên 200 request sẽ có 2 request tranh chấp 1 ghế
    const seatId = `S${(i % SEATS_COUNT) + 1}`;
    const userId = i + 1; // 200 users khác nhau
    
    const req = fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat_ids: [seatId], user_id: userId })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }).catch(err => {
      return { status: 500, error: err.message };
    });
    
    requests.push(req);
  }

  const startTime = Date.now();
  const responses = await Promise.all(requests);
  const duration = Date.now() - startTime;

  let successCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  responses.forEach(res => {
    if (res.status === 200 && res.data.success) {
      successCount++;
    } else if (res.status === 409) {
      conflictCount++;
    } else {
      errorCount++;
      console.error('Lỗi không xác định:', res.status, res.data);
    }
  });

  console.log(`Hoàn thành trong ${duration}ms`);
  console.log(`- Thành công (200): ${successCount}`);
  console.log(`- Tranh chấp (409): ${conflictCount}`);
  console.log(`- Lỗi khác: ${errorCount}`);

  if (successCount === SEATS_COUNT && conflictCount === (CONCURRENT_REQUESTS - SEATS_COUNT) && errorCount === 0) {
    console.log(`\n✅ TEST PASS: Đúng ${SEATS_COUNT} giữ chỗ thành công và đúng ${conflictCount} nhận lỗi trùng.`);
    process.exit(0);
  } else {
    console.error(`\n❌ TEST FAIL: Số lượng không khớp yêu cầu. Thành công: ${successCount}, Tranh chấp: ${conflictCount}, Lỗi: ${errorCount}`);
    process.exit(1);
  }
}

runTest();
