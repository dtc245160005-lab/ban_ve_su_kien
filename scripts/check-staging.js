const { performance } = require('node:perf_hooks');

async function checkStaging({ url, expectedRevision, fetchImpl = fetch, samples = 3 } = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('STAGING_URL phải là HTTP(S), không chứa credentials.');
  }
  if (expectedRevision && !/^[a-f0-9]{40}$/i.test(expectedRevision)) {
    throw new Error('STAGING_EXPECTED_REVISION phải là SHA đầy đủ 40 ký tự.');
  }
  const measurements = [];
  let revision;
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    const response = await fetchImpl(new URL('/health', target), { signal: AbortSignal.timeout(15000),
      cache: 'no-store', redirect: 'error' });
    const body = await response.json();
    if (response.status !== 200 || body.status !== 'ok') throw new Error('Staging readiness chưa đạt.');
    if (expectedRevision && body.revision !== expectedRevision) throw new Error('Staging đang chạy commit khác commit cần nghiệm thu.');
    const currentRevision = body.revision || null;
    if (i > 0 && currentRevision !== revision) throw new Error('Revision thay đổi trong lúc kiểm tra.');
    revision = currentRevision;
    measurements.push(Number((performance.now() - started).toFixed(3)));
  }
  for (const route of ['/', '/login.html', '/register.html']) {
    const response = await fetchImpl(new URL(route, target), { signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) throw new Error(`Trang ${route} chưa trả HTTP 200.`);
  }
  return { checkedAt: new Date().toISOString(), origin: target.origin, revision,
    health: 'PASS', pages: 'PASS', healthResponseMs: measurements,
    expectedRevisionVerified: Boolean(expectedRevision) };
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  checkStaging({ url: process.env.STAGING_URL, expectedRevision: process.env.STAGING_EXPECTED_REVISION })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      // Known validation messages only; network exceptions may contain credential-bearing URLs.
      console.error('STAGING: FAIL', /^(STAGING_|Staging|Trang)/.test(error.message) ? error.message : 'Kiểm tra URL và kết nối staging.');
      process.exitCode = 1;
    });
}
module.exports = { checkStaging };
