/* global apiFetch, renderSeatGrid */
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
      ? events.map((event) => `<article class="menu-link buyer-event">
          <strong>${escapeText(event.title)}</strong>
          <p>${escapeText(event.description || '')}</p>
          <button type="button" class="secondary-btn small-btn view-seat-map" data-event-id="${Number(event.id)}">Xem sơ đồ ghế</button>
          <div class="buyer-seat-map" hidden></div>
        </article>`).join('')
      : '<p>Hiện chưa có sự kiện mở bán.</p>';
    content.querySelectorAll('.view-seat-map').forEach((button) => {
      button.addEventListener('click', () => loadBuyerSeatMaps(button));
    });
    return;
  }
  if (workspace === 'checker') {
    content.innerHTML = `<div class="stat-card"><strong>${result.data.checkedInToday}</strong><span>vé đã soát hôm nay</span></div>`;
  } else {
    content.innerHTML = `<div class="stats-grid"><div class="stat-card"><strong>${Number(result.data.grossRevenue).toLocaleString('vi-VN')} đ</strong><span>doanh thu</span></div><div class="stat-card"><strong>${result.data.transactions}</strong><span>giao dịch</span></div></div>`;
  }
  showMessage(result.data.message, 'success');
}

async function loadBuyerSeatMaps(button) {
  const eventId = Number(button.dataset.eventId);
  const container = button.parentElement.querySelector('.buyer-seat-map');
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
  button.disabled = true;
  container.hidden = false;
  container.textContent = 'Đang tải sơ đồ ghế...';
  try {
    const response = await apiFetch(`/api/workspaces/buyer/events/${eventId}/seat-maps`);
    const result = await response.json();
    if (!response.ok) {
      container.textContent = result.message || 'Không thể tải sơ đồ ghế.';
      return;
    }
    const showtimes = result.data?.showtimes || [];
    if (!showtimes.length) {
      container.textContent = 'Sự kiện chưa có suất diễn sắp tới.';
      return;
    }
    container.innerHTML = '<p class="muted">Sơ đồ chỉ để xem; chức năng đặt/mua vé chưa được triển khai.</p>';
    for (const showtime of showtimes) {
      const section = document.createElement('section');
      section.className = 'buyer-showtime';
      const startsAt = new Date(showtime.starts_at);
      const formattedTime = Number.isNaN(startsAt.getTime())
        ? ''
        : startsAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      section.innerHTML = `<strong>${escapeText(formattedTime)} · ${escapeText(showtime.room_name || 'Chưa đặt phòng')}</strong>
        <p>${Number(showtime.seatCount) || 0} ghế</p>
        <div class="buyer-seat-legend"></div>
        <div class="buyer-seat-grid"></div>`;
      container.appendChild(section);
      if (showtime.seatCount > 0 && typeof renderSeatGrid === 'function') {
        renderSeatGrid(
          section.querySelector('.buyer-seat-grid'),
          section.querySelector('.buyer-seat-legend'),
          showtime,
        );
      } else {
        section.querySelector('.buyer-seat-grid').textContent = 'Suất diễn này chưa có sơ đồ ghế.';
      }
    }
  } catch {
    container.textContent = 'Không thể kết nối máy chủ để tải sơ đồ ghế.';
  } finally {
    button.disabled = false;
  }
}

function escapeText(value) {
  const node = document.createElement('div');
  node.textContent = String(value || '');
  return node.innerHTML;
}

loadWorkspace().catch(() => showMessage('Không thể kết nối máy chủ.'));
