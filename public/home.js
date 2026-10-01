(function () {
  const viDateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  let nextCursor = null;
  let isLoading = false;
  let hasLoadedInitial = false;

  const container = document.getElementById('showtimesContainer');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const emptyNotice = document.getElementById('emptyNotice');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const catalogMessage = document.getElementById('catalogMessage');
  const sentinel = document.getElementById('infiniteScrollSentinel');

  function showMessage(msg) {
    if (!catalogMessage) return;
    catalogMessage.textContent = msg;
    catalogMessage.style.display = 'block';
  }

  function hideMessage() {
    if (!catalogMessage) return;
    catalogMessage.textContent = '';
    catalogMessage.style.display = 'none';
  }

  function createShowtimeCard(item) {
    const card = document.createElement('div');
    card.className = 'card showtime-card';
    card.style.margin = '0';
    card.style.padding = '18px 20px';
    card.style.border = '1px solid var(--border)';
    card.style.borderRadius = '12px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '8px';

    const titleEl = document.createElement('h3');
    titleEl.style.margin = '0';
    titleEl.style.fontSize = '18px';
    titleEl.textContent = item.title;

    const timeEl = document.createElement('p');
    timeEl.style.margin = '0';
    timeEl.style.fontSize = '14px';
    timeEl.style.color = 'var(--primary)';
    timeEl.style.fontWeight = 'bold';
    let formattedTime;
    try {
      formattedTime = viDateTimeFormatter.format(new Date(item.startsAt));
    } catch {
      formattedTime = item.startsAt;
    }
    timeEl.textContent = `Thời gian: ${formattedTime} (Giờ VN)`;

    const venueEl = document.createElement('p');
    venueEl.style.margin = '0';
    venueEl.style.fontSize = '14px';
    venueEl.style.color = 'var(--muted)';
    const roomText = item.roomName ? ` (${item.roomName})` : '';
    venueEl.textContent = `Địa điểm: ${item.venue}${roomText}`;

    const priceEl = document.createElement('p');
    priceEl.style.margin = '0';
    priceEl.style.fontSize = '14px';
    if (item.minPrice === null && item.maxPrice === null) {
      priceEl.textContent = 'Giá vé: Giá sẽ cập nhật';
    } else {
      priceEl.textContent = `Giá vé: ${item.minPrice || 0} - ${item.maxPrice || 0} VNĐ`;
    }

    const actionRow = document.createElement('div');
    actionRow.style.marginTop = '8px';

    const detailLink = document.createElement('a');
    detailLink.href = `/showtime.html?id=${encodeURIComponent(item.showtimeId)}`;
    detailLink.className = 'primary-btn small-btn';
    detailLink.style.display = 'inline-block';
    detailLink.style.width = 'auto';
    detailLink.style.padding = '8px 18px';
    detailLink.style.textDecoration = 'none';
    detailLink.style.textAlign = 'center';
    detailLink.textContent = 'Xem chi tiết';

    actionRow.appendChild(detailLink);

    card.appendChild(titleEl);
    card.appendChild(timeEl);
    card.appendChild(venueEl);
    card.appendChild(priceEl);
    card.appendChild(actionRow);

    return card;
  }

  async function loadShowtimes() {
    if (isLoading) return;
    isLoading = true;
    hideMessage();
    if (loadingIndicator) loadingIndicator.style.display = 'block';

    try {
      const url = nextCursor
        ? `/api/events/showtimes?limit=20&cursor=${encodeURIComponent(nextCursor)}`
        : '/api/events/showtimes?limit=20';

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Không thể tải danh sách suất diễn.');
      }

      const body = await res.json();
      const items = body.items || body.data?.items || (Array.isArray(body.data) ? body.data : []);
      nextCursor = body.nextCursor !== undefined ? body.nextCursor : (body.data?.nextCursor || null);

      if (items.length > 0) {
        for (const item of items) {
          const card = createShowtimeCard(item);
          container.appendChild(card);
        }
      }

      if (!hasLoadedInitial) {
        hasLoadedInitial = true;
        if (items.length === 0 && emptyNotice) {
          emptyNotice.style.display = 'block';
        }
      }

      if (loadMoreBtn) {
        if (nextCursor) {
          loadMoreBtn.style.display = 'inline-block';
        } else {
          loadMoreBtn.style.display = 'none';
        }
      }
    } catch (err) {
      showMessage(err.message || 'Lỗi khi tải danh sách suất diễn.');
    } finally {
      isLoading = false;
      if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (nextCursor && !isLoading) {
        loadShowtimes();
      }
    });
  }

  if (sentinel && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !isLoading) {
          loadShowtimes();
        }
      },
      { rootMargin: '150px' }
    );
    observer.observe(sentinel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadShowtimes);
  } else {
    loadShowtimes();
  }
})();
