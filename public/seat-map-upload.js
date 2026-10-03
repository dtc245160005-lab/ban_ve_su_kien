/* global apiFetch, validateSeatMapText, renderSeatGrid */
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const showtimeId = urlParams.get('showtimeId');
  const eventId = urlParams.get('eventId');

  // Elements
  const accountSummary = document.getElementById('accountSummary');
  const logoutBtn = document.getElementById('logoutBtn');
  const showtimeTitle = document.getElementById('showtimeTitle');
  const showtimeBadge = document.getElementById('showtimeBadge');
  const globalMessage = document.getElementById('globalMessage');
  const savedSeatMapStatus = document.getElementById('savedSeatMapStatus');
  const backToEventLink = document.getElementById('backToEventLink');

  const uploadSeatMapForm = document.getElementById('uploadSeatMapForm');
  const seatMapFile = document.getElementById('seatMapFile');
  const seatMapFileError = document.getElementById('seatMapFileError');
  const uploadMsg = document.getElementById('uploadMsg');
  const uploadBtn = document.getElementById('uploadBtn');

  // Error section elements
  const errorSection = document.getElementById('errorSection');
  const errorCountBadge = document.getElementById('errorCountBadge');
  const truncatedWarning = document.getElementById('truncatedWarning');
  const errorTableBody = document.getElementById('errorTableBody');

  // Preview section elements
  const previewSection = document.getElementById('previewSection');
  const summarySeatCount = document.getElementById('summarySeatCount');
  const summaryCategoryCount = document.getElementById('summaryCategoryCount');
  const summaryRowCount = document.getElementById('summaryRowCount');
  const legendContainer = document.getElementById('legendContainer');
  const seatGridContainer = document.getElementById('seatGridContainer');

  let currentUser = null;
  let selectedFile = null;

  function setEventBackLink(id) {
    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) return;
    backToEventLink.href = `/organizer-events.html?id=${encodeURIComponent(id)}`;
  }

  setEventBackLink(eventId);

  async function loadSavedSeatMapStatus() {
    try {
      const response = await apiFetch(`/api/organizer/showtimes/${showtimeId}/seats/status`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        savedSeatMapStatus.textContent = result.message || 'Không thể kiểm tra sơ đồ ghế đã lưu.';
        return;
      }
      setEventBackLink(result.data?.event_id);
      const count = result.data?.seats_count || 0;
      savedSeatMapStatus.textContent = count > 0
        ? `Đã lưu ${count} ghế cho suất diễn này. Nạp tệp mới sẽ thay thế sơ đồ hiện tại.`
        : 'Suất diễn này chưa có sơ đồ ghế được lưu.';
    } catch {
      savedSeatMapStatus.textContent = 'Không thể kiểm tra sơ đồ ghế đã lưu.';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clearMessages() {
    seatMapFileError.textContent = '';
    uploadMsg.textContent = '';
    uploadMsg.className = '';
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

  function renderErrors(errors, truncated = false) {
    previewSection.style.display = 'none';
    errorSection.style.display = 'block';

    const errList = Array.isArray(errors) ? errors : [];
    errorCountBadge.textContent = `${errList.length} lỗi`;
    truncatedWarning.style.display = truncated ? 'block' : 'none';

    errorTableBody.innerHTML = '';
    errList.forEach((err, idx) => {
      const row = document.createElement('tr');
      const stt = idx + 1;
      const seatPos = err.index !== null && err.index !== undefined ? `Ghế #${err.index + 1}` : '-';
      const field = err.field || '-';

      let jsonPos = '-';
      if (err.line !== null && err.column !== null && err.line !== undefined && err.column !== undefined) {
        jsonPos = `Dòng ${err.line}, Cột ${err.column}`;
      } else if (err.position !== null && err.position !== undefined) {
        jsonPos = `Ký tự ${err.position}`;
      }

      const msg = err.message || '';

      row.innerHTML = `
        <td>${stt}</td>
        <td><strong>${escapeHtml(seatPos)}</strong></td>
        <td><code>${escapeHtml(field)}</code></td>
        <td>${escapeHtml(jsonPos)}</td>
        <td style="color: var(--error-text);">${escapeHtml(msg)}</td>
      `;
      errorTableBody.appendChild(row);
    });
  }

  function renderPreview(summary) {
    errorSection.style.display = 'none';
    previewSection.style.display = 'block';

    if (summary) {
      summarySeatCount.textContent = summary.seatCount || 0;
      summaryCategoryCount.textContent = summary.categories ? summary.categories.length : 0;
      summaryRowCount.textContent = summary.rows ? summary.rows.length : 0;

      if (typeof renderSeatGrid === 'function') {
        renderSeatGrid(seatGridContainer, legendContainer, summary);
      }
    }
  }

  // File change handler
  seatMapFile.onchange = () => {
    clearMessages();
    const files = seatMapFile.files;
    if (!files || !files.length) {
      selectedFile = null;
      uploadBtn.disabled = true;
      errorSection.style.display = 'none';
      previewSection.style.display = 'none';
      return;
    }

    const file = files[0];
    selectedFile = file;

    // Kiểm tra dung lượng tệp 5 MB
    if (file.size > 5 * 1024 * 1024) {
      seatMapFileError.textContent = 'Tệp vượt quá giới hạn 5 MB.';
      uploadBtn.disabled = true;
      errorSection.style.display = 'none';
      previewSection.style.display = 'none';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const validator = typeof validateSeatMapText === 'function'
        ? validateSeatMapText
        : (window.SeatMapValidator && window.SeatMapValidator.validateSeatMapText);

      if (!validator) {
        console.error('validateSeatMapText not loaded');
        return;
      }

      const result = validator(text);
      if (!result.valid) {
        uploadBtn.disabled = true;
        renderErrors(result.errors, result.truncated);
      } else {
        renderPreview(result.summary);
        uploadBtn.disabled = false;
      }
    };

    reader.onerror = () => {
      seatMapFileError.textContent = 'Không thể đọc tệp đã chọn.';
      uploadBtn.disabled = true;
      errorSection.style.display = 'none';
      previewSection.style.display = 'none';
    };

    reader.readAsText(file);
  };

  let isSubmitting = false;

  // Form submit handler
  uploadSeatMapForm.onsubmit = async (e) => {
    e.preventDefault();
    if (uploadBtn.disabled || isSubmitting) return;
    clearMessages();

    if (!selectedFile) {
      seatMapFileError.textContent = 'Vui lòng chọn tệp sơ đồ ghế.';
      return;
    }

    if (!showtimeId) {
      uploadMsg.className = 'message error';
      uploadMsg.textContent = 'Thiếu mã suất diễn (showtimeId) trên URL.';
      return;
    }

    // Chặn bấm hai lần
    isSubmitting = true;
    uploadBtn.disabled = true;
    uploadMsg.className = 'message warning';
    uploadMsg.textContent = 'Đang nạp sơ đồ ghế lên máy chủ...';

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await apiFetch(`/api/organizer/showtimes/${showtimeId}/seats/import`, {
        method: 'POST',
        body: formData,
      });

      const resData = await res.json().catch(() => ({}));

      if (res.status === 200) {
        uploadMsg.className = 'message success';
        const seatsCount = resData.data?.seats_count || 0;
        const categoriesCount = resData.data?.categories_count || 0;
        uploadMsg.textContent = `Nạp sơ đồ ghế thành công! (${seatsCount} ghế, ${categoriesCount} hạng ghế).`;
        await loadSavedSeatMapStatus();
        uploadBtn.disabled = false;
        return;
      }

      if (res.status === 403) {
        uploadMsg.className = 'message error';
        uploadMsg.textContent = 'Bạn không có quyền với suất diễn này';
        uploadBtn.disabled = true;
        return;
      }

      if (res.status === 409) {
        uploadMsg.className = 'message error';
        uploadMsg.textContent = resData.message || 'Không thể nạp lại khi suất diễn có vé hoặc ghế đang giữ.';
        uploadBtn.disabled = true;
        return;
      }

      if (res.status === 400) {
        uploadMsg.className = 'message error';
        uploadMsg.textContent = resData.message || 'Tệp sơ đồ không hợp lệ.';
        if (resData.errors && Array.isArray(resData.errors)) {
          renderErrors(resData.errors, Boolean(resData.truncated));
        }
        uploadBtn.disabled = true;
        return;
      }

      // 500 hoặc lỗi hệ thống khác -> cho bấm lại
      uploadMsg.className = 'message error';
      uploadMsg.textContent = resData.message || 'Hệ thống đang bận. Vui lòng thử lại sau.';
      uploadBtn.disabled = false;
    } catch (err) {
      console.error('Lỗi gửi tệp sơ đồ ghế:', err);
      // Lỗi kết nối / mạng -> cho bấm lại
      uploadMsg.className = 'message error';
      uploadMsg.textContent = 'Lỗi kết nối khi nạp sơ đồ ghế. Vui lòng thử lại.';
      uploadBtn.disabled = false;
    } finally {
      isSubmitting = false;
    }
  };

  logoutBtn.onclick = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login.html');
  };

  async function init() {
    await checkAuth();

    if (!showtimeId) {
      globalMessage.className = 'message error';
      globalMessage.textContent = 'Thiếu tham số showtimeId trên URL. Vui lòng mở từ danh sách suất diễn.';
      uploadBtn.disabled = true;
      showtimeTitle.textContent = 'Suất diễn không xác định';
      return;
    }

    showtimeTitle.textContent = `Nhập sơ đồ ghế cho suất diễn #${showtimeId}`;
    showtimeBadge.textContent = `Suất #${showtimeId}`;
    await loadSavedSeatMapStatus();
  }

  init();
})();
