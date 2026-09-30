/* global apiFetch */
const workspace = document.body.dataset.workspace;
const content = document.getElementById('workspaceContent');
const message = document.getElementById('workspaceMessage');

function showMessage(text, type = 'error') {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
}

async function loadWorkspace() {
  const response = await apiFetch(`/api/workspaces/${workspace}`);
  const result = await response.json();
  if (!response.ok) {
    showMessage(result.message || 'Bạn không có quyền truy cập khu vực này.');
    return;
  }
  if (workspace === 'buyer') {
    const events = result.data.events || [];
    content.innerHTML = events.length
      ? events.map((event) => `<article class="menu-link"><strong>${escapeText(event.title)}</strong><p>${escapeText(event.description || '')}</p></article>`).join('')
      : '<p>Hiện chưa có sự kiện mở bán.</p>';
    return;
  }
  if (workspace === 'checker') {
    content.innerHTML = `<div class="stat-card"><strong>${result.data.checkedInToday}</strong><span>vé đã soát hôm nay</span></div>`;
  } else {
    content.innerHTML = `<div class="stats-grid"><div class="stat-card"><strong>${Number(result.data.grossRevenue).toLocaleString('vi-VN')} đ</strong><span>doanh thu</span></div><div class="stat-card"><strong>${result.data.transactions}</strong><span>giao dịch</span></div></div>`;
  }
  showMessage(result.data.message, 'success');
}

function escapeText(value) {
  const node = document.createElement('div');
  node.textContent = String(value || '');
  return node.innerHTML;
}

loadWorkspace().catch(() => showMessage('Không thể kết nối máy chủ.'));
