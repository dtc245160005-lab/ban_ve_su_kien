const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function waitFor(check) {
  for (let i = 0; i < 50; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for buyer seat map');
}

test('buyer can open the saved seat grid from a published event card', async () => {
  const dom = new JSDOM(`<!doctype html><body data-workspace="buyer">
    <div id="workspaceMessage"></div><div id="workspaceContent"></div></body>`, {
    runScripts: 'outside-only', url: 'http://localhost/buyer.html',
  });
  const { window } = dom;
  const requested = [];
  window.apiFetch = async (url) => {
    requested.push(url);
    if (url === '/api/workspaces/buyer') {
      return { ok: true, json: async () => ({ data: { events: [{ id: 7, title: 'Demo', description: '' }] } }) };
    }
    return {
      ok: true,
      json: async () => ({ data: { showtimes: [{
        id: 1, starts_at: new Date(Date.now() + 86400000).toISOString(), room_name: 'Phòng A',
        seatCount: 50, categories: [{ name: 'VIP', count: 20 }],
        rows: [{ row: 'A', seats: [{ number: 1, category: 'VIP' }] }],
      }] } }),
    };
  };
  window.renderSeatGrid = (grid) => { grid.textContent = '50 ghế đã hiển thị'; };
  window.eval(fs.readFileSync(path.join(__dirname, '../public/role-workspace.js'), 'utf8'));

  await waitFor(() => window.document.querySelector('.view-seat-map'));
  window.document.querySelector('.view-seat-map').click();
  await waitFor(() => window.document.querySelector('.buyer-seat-grid')?.textContent.includes('50 ghế'));
  assert.ok(requested.includes('/api/workspaces/buyer/events/7/seat-maps'));
  assert.match(window.document.querySelector('.buyer-seat-map').textContent, /chưa được triển khai/);
  dom.window.close();
});
