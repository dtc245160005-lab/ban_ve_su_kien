(function () {
  const loadingIndicator = document.getElementById('loadingIndicator');
  const errorMessage = document.getElementById('errorMessage');
  const showtimeDetail = document.getElementById('showtimeDetail');
  const notOnSaleNotice = document.getElementById('notOnSaleNotice');
  const chooseSeatBtn = document.getElementById('chooseSeatBtn');

  function showError(msg) {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    if (showtimeDetail) showtimeDetail.style.display = 'none';
    if (errorMessage) {
      errorMessage.textContent = msg;
      errorMessage.style.display = 'block';
    }
  }

  function hideError() {
    if (errorMessage) {
      errorMessage.textContent = '';
      errorMessage.style.display = 'none';
    }
  }

  function updateMetaTags(data) {
    document.title = `${data.title} - Chi tiết suất diễn`;
    const descContent = data.description ? data.description.slice(0, 160) : data.title;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', descContent);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', data.title);

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', descContent);

    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) ogType.setAttribute('content', 'website');

    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', window.location.href);
  }

  async function loadShowtimeDetail() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (!id || Number.isNaN(Number(id))) {
      showError('Không tìm thấy suất diễn.');
      return;
    }

    hideError();
    if (loadingIndicator) loadingIndicator.style.display = 'block';

    try {
      const res = await fetch(`/api/events/showtimes/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
      });

      if (res.status === 404) {
        showError('Không tìm thấy suất diễn.');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showError(body.message || 'Không tìm thấy suất diễn.');
        return;
      }

      const body = await res.json();
      const data = body.data || body;

      if (!data || !data.showtimeId) {
        showError('Không tìm thấy suất diễn.');
        return;
      }

      updateMetaTags(data);

      document.getElementById('showtimeTitle').textContent = data.title || '';
      document.getElementById('showtimeDescription').textContent = data.description || 'Không có mô tả chi tiết.';

      let formattedDate;
      try {
        const viDateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        formattedDate = viDateTimeFormatter.format(new Date(data.startsAt));
      } catch {
        formattedDate = data.startsAt || '';
      }
      document.getElementById('showtimeStartsAt').textContent = `${formattedDate} (Giờ VN)`;
      document.getElementById('showtimeVenue').textContent = data.venue || '';
      document.getElementById('showtimeRoom').textContent = data.roomName || 'Tiêu chuẩn';

      if (data.minPrice === null && data.maxPrice === null) {
        document.getElementById('showtimePrice').textContent = 'Giá sẽ cập nhật';
      } else {
        document.getElementById('showtimePrice').textContent = `${data.minPrice || 0} - ${data.maxPrice || 0} VNĐ`;
      }

      if (data.onSale === false) {
        if (notOnSaleNotice) {
          notOnSaleNotice.textContent = 'Suất diễn này hiện không mở bán';
          notOnSaleNotice.style.display = 'block';
        }
        if (chooseSeatBtn) {
          chooseSeatBtn.style.display = 'none';
        }
      } else {
        if (notOnSaleNotice) {
          notOnSaleNotice.style.display = 'none';
        }
        if (chooseSeatBtn) {
          chooseSeatBtn.style.display = 'inline-block';
        }
      }

      if (loadingIndicator) loadingIndicator.style.display = 'none';
      if (showtimeDetail) showtimeDetail.style.display = 'block';
    } catch {
      showError('Không tìm thấy suất diễn.');
    }
  }

  if (chooseSeatBtn) {
    chooseSeatBtn.addEventListener('click', async () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      const seatMapTarget = `/seat-map.html?showtime=${encodeURIComponent(id)}`;

      try {
        const sessionRes = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });

        if (sessionRes.status === 401) {
          window.location.href = `/login.html?next=${encodeURIComponent(seatMapTarget)}`;
          return;
        }

        if (sessionRes.ok) {
          window.location.href = seatMapTarget;
          return;
        }

        window.location.href = `/login.html?next=${encodeURIComponent(seatMapTarget)}`;
      } catch {
        window.location.href = `/login.html?next=${encodeURIComponent(seatMapTarget)}`;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadShowtimeDetail);
  } else {
    loadShowtimeDetail();
  }
})();
