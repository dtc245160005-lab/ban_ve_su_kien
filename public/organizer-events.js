/* global apiFetch, validateEventForm, validateShowtimeForm, toIsoVietnam, formatVietnamDateTime */
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const currentEventId = urlParams.get('id');

  // Elements
  const accountSummary = document.getElementById('accountSummary');
  const logoutBtn = document.getElementById('logoutBtn');

  // List view elements
  const listView = document.getElementById('listView');
  const createEventForm = document.getElementById('createEventForm');
  const createTitle = document.getElementById('createTitle');
  const createVenue = document.getElementById('createVenue');
  const createDescription = document.getElementById('createDescription');
  const createTitleError = document.getElementById('createTitleError');
  const createVenueError = document.getElementById('createVenueError');
  const createDescriptionError = document.getElementById('createDescriptionError');
  const createEventBtn = document.getElementById('createEventBtn');
  const createEventMsg = document.getElementById('createEventMsg');
  const eventsListContainer = document.getElementById('eventsListContainer');

  // Detail view elements
  const detailView = document.getElementById('detailView');
  const forbiddenMessage = document.getElementById('forbiddenMessage');
  const detailContent = document.getElementById('detailContent');
  const eventStatusBadge = document.getElementById('eventStatusBadge');
  const editEventForm = document.getElementById('editEventForm');
  const editTitle = document.getElementById('editTitle');
  const editVenue = document.getElementById('editVenue');
  const editDescription = document.getElementById('editDescription');
  const editTitleError = document.getElementById('editTitleError');
  const editVenueError = document.getElementById('editVenueError');
  const editDescriptionError = document.getElementById('editDescriptionError');
  const saveEventBtn = document.getElementById('saveEventBtn');
  const deleteEventBtn = document.getElementById('deleteEventBtn');
  const editEventMsg = document.getElementById('editEventMsg');

  // Showtime elements
  const showtimeWarning = document.getElementById('showtimeWarning');
  const addShowtimeForm = document.getElementById('addShowtimeForm');
  const showtimeStartsAt = document.getElementById('showtimeStartsAt');
  const showtimeRoomName = document.getElementById('showtimeRoomName');
  const showtimeStartsAtError = document.getElementById('showtimeStartsAtError');
  const showtimeRoomNameError = document.getElementById('showtimeRoomNameError');
  const addShowtimeBtn = document.getElementById('addShowtimeBtn');
  const addShowtimeMsg = document.getElementById('addShowtimeMsg');
  const showtimesListContainer = document.getElementById('showtimesListContainer');

  let currentUser = null;

  function clearErrors() {
    createTitleError.textContent = '';
    createVenueError.textContent = '';
    createDescriptionError.textContent = '';
    createEventMsg.textContent = '';
    createEventMsg.className = '';

    editTitleError.textContent = '';
    editVenueError.textContent = '';
    editDescriptionError.textContent = '';
    editEventMsg.textContent = '';
    editEventMsg.className = '';

    showtimeStartsAtError.textContent = '';
    showtimeRoomNameError.textContent = '';
    addShowtimeMsg.textContent = '';
    addShowtimeMsg.className = '';
  }

  async function checkAuth() {
    try {
      const res = await apiFetch('/api/auth/session');
      if (!res.ok) return;

      const data = await res.json();
      currentUser = data.user || {};
      const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [];

      accountSummary.textContent = `${currentUser.email || currentUser.userId || ''} (${roles.join(', ')})`;

      const canManage = roles.includes('organizer') || roles.includes('admin');
      if (!canManage) {
        window.location.replace('/app.html');
      }
    } catch (err) {
      console.error('Lỗi kiểm tra phiên:', err);
    }
  }

  // Khởi chạy view tương ứng
  async function init() {
    await checkAuth();

    if (currentEventId) {
      listView.style.display = 'none';
      detailView.style.display = 'block';
      await loadEventDetail(currentEventId);
    } else {
      listView.style.display = 'block';
      detailView.style.display = 'none';
      await loadEventsList();
    }
  }

  // Tải danh sách sự kiện
  async function loadEventsList() {
    try {
      eventsListContainer.innerHTML = '<p class="muted">Đang tải danh sách sự kiện...</p>';
      const res = await apiFetch('/api/organizer/events');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        eventsListContainer.innerHTML = `<div class="message error">${errData.message || 'Không thể tải danh sách sự kiện.'}</div>`;
        return;
      }

      const resData = await res.json();
      const events = resData.data || resData.events || [];

      if (events.length === 0) {
        eventsListContainer.innerHTML = '<p class="muted">Bạn chưa tạo sự kiện nào.</p>';
        return;
      }

      eventsListContainer.innerHTML = '';
      for (const ev of events) {
        const item = document.createElement('div');
        item.className = 'event-card';

        const statusClass = ev.status === 'published' ? 'published' : ev.status === 'archived' ? 'archived' : 'draft';
        const statusText = ev.status === 'published' ? 'Đã xuất bản' : ev.status === 'archived' ? 'Đã lưu trữ' : 'Bản nháp';

        item.innerHTML = `
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <strong style="font-size: 16px;">${escapeHtml(ev.title)}</strong>
              <span class="badge ${statusClass}">${statusText}</span>
            </div>
            <p class="muted" style="margin: 0; font-size: 14px;">
              ${escapeHtml(ev.venue || 'Chưa có địa điểm')} · <b>${ev.showtimes_count || 0}</b> suất diễn
            </p>
          </div>
          <div class="actions-row">
            <a href="/organizer-events.html?id=${ev.id}" class="secondary-btn small-btn" style="text-decoration: none;">Chi tiết & Suất diễn</a>
          </div>
        `;
        eventsListContainer.appendChild(item);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách sự kiện:', err);
      eventsListContainer.innerHTML = '<div class="message error">Lỗi hệ thống khi tải danh sách sự kiện.</div>';
    }
  }

  // Tải chi tiết sự kiện
  async function loadEventDetail(id) {
    try {
      const res = await apiFetch(`/api/organizer/events/${id}`);
      if (res.status === 403) {
        forbiddenMessage.style.display = 'block';
        forbiddenMessage.textContent = 'Bạn không có quyền xem sự kiện này';
        detailContent.style.display = 'none';
        return;
      }

      if (res.status === 404) {
        forbiddenMessage.style.display = 'block';
        forbiddenMessage.textContent = 'Sự kiện không tồn tại.';
        detailContent.style.display = 'none';
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        forbiddenMessage.style.display = 'block';
        forbiddenMessage.textContent = errData.message || 'Lỗi khi tải thông tin sự kiện.';
        detailContent.style.display = 'none';
        return;
      }

      forbiddenMessage.style.display = 'none';
      detailContent.style.display = 'block';

      const resData = await res.json();
      const event = resData.data || resData.event || {};
      const showtimes = event.showtimes || resData.showtimes || [];

      // Điền thông tin sự kiện vào form
      editTitle.value = event.title || '';
      editVenue.value = event.venue || '';
      editDescription.value = event.description || '';

      const statusClass = event.status === 'published' ? 'published' : event.status === 'archived' ? 'archived' : 'draft';
      const statusText = event.status === 'published' ? 'Đã xuất bản' : event.status === 'archived' ? 'Đã lưu trữ' : 'Bản nháp';
      eventStatusBadge.className = `badge ${statusClass}`;
      eventStatusBadge.textContent = statusText;

      renderShowtimes(showtimes);
    } catch (err) {
      console.error('Lỗi tải chi tiết sự kiện:', err);
      forbiddenMessage.style.display = 'block';
      forbiddenMessage.textContent = 'Lỗi hệ thống khi tải sự kiện.';
      detailContent.style.display = 'none';
    }
  }

  // Render danh sách suất diễn
  function renderShowtimes(showtimes) {
    if (!showtimes || showtimes.length === 0) {
      showtimesListContainer.innerHTML = '<p class="muted">Chưa có suất diễn nào.</p>';
      return;
    }

    showtimesListContainer.innerHTML = '';
    showtimes.forEach((st) => {
      const row = document.createElement('div');
      row.className = 'showtime-row';

      const formattedTime = typeof formatVietnamDateTime === 'function'
        ? formatVietnamDateTime(st.starts_at)
        : new Intl.DateTimeFormat('vi-VN', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
          }).format(new Date(st.starts_at));

      const roomText = st.room_name ? ` · <b>${escapeHtml(st.room_name)}</b>` : ' · <i>(Chưa đặt phòng)</i>';

      row.innerHTML = `
        <div>
          <span style="font-weight: 600;">${formattedTime}</span>
          <span>${roomText}</span>
        </div>
        <div class="actions-row">
          <button type="button" class="secondary-btn small-btn edit-st-btn">Sửa</button>
          <button type="button" class="danger-btn delete-st-btn">Xoá</button>
        </div>
      `;

      // Sửa suất diễn
      row.querySelector('.edit-st-btn').onclick = async () => {
        await handleEditShowtime(st);
      };

      // Xoá suất diễn
      row.querySelector('.delete-st-btn').onclick = async () => {
        await handleDeleteShowtime(st.id);
      };

      showtimesListContainer.appendChild(row);
    });
  }

  // Tạo sự kiện mới
  createEventForm.onsubmit = async (e) => {
    e.preventDefault();
    if (createEventBtn.disabled) return;
    clearErrors();

    const title = createTitle.value.trim();
    const venue = createVenue.value.trim();
    const description = createDescription.value.trim();

    // Client validation
    const validation = typeof validateEventForm === 'function'
      ? validateEventForm({ title, venue, description })
      : { valid: true, errors: {} };
    if (!validation.valid) {
      if (validation.errors.title) createTitleError.textContent = validation.errors.title;
      if (validation.errors.venue) createVenueError.textContent = validation.errors.venue;
      if (validation.errors.description) createDescriptionError.textContent = validation.errors.description;
      return;
    }

    createEventBtn.disabled = true;
    try {
      const res = await apiFetch('/api/organizer/events', {
        method: 'POST',
        body: JSON.stringify({ title, venue, description }),
      });

      const resData = await res.json().catch(() => ({}));
      if (res.status === 400 && resData.errors) {
        if (resData.errors.title) createTitleError.textContent = resData.errors.title;
        if (resData.errors.venue) createVenueError.textContent = resData.errors.venue;
        if (resData.errors.description) createDescriptionError.textContent = resData.errors.description;
        return;
      }

      if (!res.ok) {
        createEventMsg.className = 'message error';
        createEventMsg.textContent = resData.message || 'Lỗi khi tạo sự kiện.';
        return;
      }

      createEventForm.reset();
      createEventMsg.className = 'message success';
      createEventMsg.textContent = 'Đã tạo sự kiện thành công ở trạng thái nháp.';
      await loadEventsList();
    } catch (err) {
      console.error('Lỗi gửi form tạo sự kiện:', err);
      createEventMsg.className = 'message error';
      createEventMsg.textContent = 'Lỗi kết nối khi tạo sự kiện.';
    } finally {
      createEventBtn.disabled = false;
    }
  };

  // Cập nhật sự kiện
  editEventForm.onsubmit = async (e) => {
    e.preventDefault();
    if (saveEventBtn.disabled) return;
    clearErrors();

    const title = editTitle.value.trim();
    const venue = editVenue.value.trim();
    const description = editDescription.value.trim();

    // Client validation
    const validation = typeof validateEventForm === 'function'
      ? validateEventForm({ title, venue, description })
      : { valid: true, errors: {} };
    if (!validation.valid) {
      if (validation.errors.title) editTitleError.textContent = validation.errors.title;
      if (validation.errors.venue) editVenueError.textContent = validation.errors.venue;
      if (validation.errors.description) editDescriptionError.textContent = validation.errors.description;
      return;
    }

    saveEventBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/organizer/events/${currentEventId}`, {
        method: 'PUT',
        body: JSON.stringify({ title, venue, description }),
      });

      const resData = await res.json().catch(() => ({}));
      if (res.status === 400 && resData.errors) {
        if (resData.errors.title) editTitleError.textContent = resData.errors.title;
        if (resData.errors.venue) editVenueError.textContent = resData.errors.venue;
        if (resData.errors.description) editDescriptionError.textContent = resData.errors.description;
        return;
      }

      if (!res.ok) {
        editEventMsg.className = 'message error';
        editEventMsg.textContent = resData.message || 'Lỗi khi cập nhật sự kiện.';
        return;
      }

      editEventMsg.className = 'message success';
      editEventMsg.textContent = 'Đã lưu thay đổi sự kiện thành công.';
    } catch (err) {
      console.error('Lỗi cập nhật sự kiện:', err);
      editEventMsg.className = 'message error';
      editEventMsg.textContent = 'Lỗi kết nối khi cập nhật sự kiện.';
    } finally {
      saveEventBtn.disabled = false;
    }
  };

  // Xoá sự kiện
  deleteEventBtn.onclick = async () => {
    if (!confirm('Bạn có chắc chắn muốn xoá sự kiện này không?')) return;

    deleteEventBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/organizer/events/${currentEventId}`, {
        method: 'DELETE',
      });

      const resData = await res.json().catch(() => ({}));
      if (res.status === 409) {
        editEventMsg.className = 'message error';
        editEventMsg.textContent = resData.message || 'Không thể xoá sự kiện khi còn suất diễn.';
        return;
      }

      if (!res.ok) {
        editEventMsg.className = 'message error';
        editEventMsg.textContent = resData.message || 'Lỗi khi xoá sự kiện.';
        return;
      }

      alert('Đã xoá sự kiện thành công.');
      window.location.href = '/organizer-events.html';
    } catch (err) {
      console.error('Lỗi xoá sự kiện:', err);
      editEventMsg.className = 'message error';
      editEventMsg.textContent = 'Lỗi kết nối khi xoá sự kiện.';
    } finally {
      deleteEventBtn.disabled = false;
    }
  };

  // Thêm suất diễn
  addShowtimeForm.onsubmit = async (e) => {
    e.preventDefault();
    if (addShowtimeBtn.disabled) return;
    clearErrors();
    showtimeWarning.style.display = 'none';

    const rawStartsAt = showtimeStartsAt.value;
    const roomName = showtimeRoomName.value.trim();

    // Chuyển sang ISO có +07:00
    const startsAtIso = typeof toIsoVietnam === 'function' ? toIsoVietnam(rawStartsAt) : rawStartsAt;

    // Client validation
    const validation = typeof validateShowtimeForm === 'function'
      ? validateShowtimeForm({ starts_at: startsAtIso, room_name: roomName })
      : { valid: true, errors: {} };

    if (!validation.valid) {
      if (validation.errors.starts_at) showtimeStartsAtError.textContent = validation.errors.starts_at;
      if (validation.errors.room_name) showtimeRoomNameError.textContent = validation.errors.room_name;
      return;
    }

    addShowtimeBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/organizer/events/${currentEventId}/showtimes`, {
        method: 'POST',
        body: JSON.stringify({ starts_at: startsAtIso, room_name: roomName }),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.status === 400 && resData.errors) {
        if (resData.errors.starts_at) showtimeStartsAtError.textContent = resData.errors.starts_at;
        if (resData.errors.room_name) showtimeRoomNameError.textContent = resData.errors.room_name;
        return;
      }

      if (!res.ok) {
        addShowtimeMsg.className = 'message error';
        addShowtimeMsg.textContent = resData.message || 'Lỗi khi thêm suất diễn.';
        return;
      }

      // Xử lý cảnh báo trùng giờ nếu có
      if (resData.warnings && Array.isArray(resData.warnings) && resData.warnings.length > 0) {
        showtimeWarning.style.display = 'block';
        showtimeWarning.textContent = resData.warnings.join('; ');
      } else {
        showtimeWarning.style.display = 'none';
      }

      addShowtimeForm.reset();
      addShowtimeMsg.className = 'message success';
      addShowtimeMsg.textContent = 'Đã thêm suất diễn thành công.';

      await loadEventDetail(currentEventId);
    } catch (err) {
      console.error('Lỗi thêm suất diễn:', err);
      addShowtimeMsg.className = 'message error';
      addShowtimeMsg.textContent = 'Lỗi kết nối khi thêm suất diễn.';
    } finally {
      addShowtimeBtn.disabled = false;
    }
  };

  // Sửa suất diễn
  async function handleEditShowtime(showtime) {
    const d = new Date(showtime.starts_at);
    const vnDate = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const defaultDatetime = vnDate.toISOString().slice(0, 16);

    const newStartsAt = prompt('Thời điểm bắt đầu mới (YYYY-MM-DDTHH:mm):', defaultDatetime);
    if (newStartsAt === null) return;

    const newRoomName = prompt('Phòng / Khán phòng:', showtime.room_name || '');
    if (newRoomName === null) return;

    const startsAtIso = typeof toIsoVietnam === 'function' ? toIsoVietnam(newStartsAt) : newStartsAt;
    const validation = typeof validateShowtimeForm === 'function'
      ? validateShowtimeForm({ starts_at: startsAtIso, room_name: newRoomName })
      : { valid: true, errors: {} };

    if (!validation.valid) {
      const errMsgs = Object.values(validation.errors).join('\n');
      alert(`Dữ liệu không hợp lệ:\n${errMsgs}`);
      return;
    }

    try {
      const res = await apiFetch(`/api/organizer/showtimes/${showtime.id}`, {
        method: 'PUT',
        body: JSON.stringify({ starts_at: startsAtIso, room_name: newRoomName }),
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.message || (resData.errors ? Object.values(resData.errors).join('\n') : 'Lỗi khi sửa suất diễn.'));
        return;
      }

      if (resData.warnings && Array.isArray(resData.warnings) && resData.warnings.length > 0) {
        showtimeWarning.style.display = 'block';
        showtimeWarning.textContent = resData.warnings.join('; ');
      }

      await loadEventDetail(currentEventId);
    } catch {
      alert('Lỗi kết nối khi sửa suất diễn.');
    }
  }

  // Xoá suất diễn
  async function handleDeleteShowtime(showtimeId) {
    if (!confirm('Bạn có chắc chắn muốn xoá suất diễn này không?')) return;

    try {
      const res = await apiFetch(`/api/organizer/showtimes/${showtimeId}`, {
        method: 'DELETE',
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.message || 'Lỗi khi xoá suất diễn.');
        return;
      }

      await loadEventDetail(currentEventId);
    } catch {
      alert('Lỗi kết nối khi xoá suất diễn.');
    }
  }

  // Đăng xuất
  logoutBtn.onclick = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login.html');
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  init();
})();
