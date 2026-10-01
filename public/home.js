(function () {
  const list = document.getElementById('publicEventList');
  const message = document.getElementById('publicEventMessage');
  if (!list || !message) return;
  fetch('/api/events', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error('API unavailable');
      return response.json();
    })
    .then((result) => {
      const events = Array.isArray(result.data) ? result.data : [];
      message.textContent = events.length ? '' : 'Chưa có sự kiện nào được công bố. Hãy quay lại sau.';
      message.hidden = events.length > 0;
      for (const event of events) {
        const card = document.createElement('article');
        card.className = 'public-event-card';
        const title = document.createElement('h3');
        title.textContent = event.title;
        const venue = document.createElement('p');
        venue.textContent = event.venue || 'Địa điểm sẽ cập nhật';
        const description = document.createElement('p');
        description.textContent = event.description || 'Thông tin chi tiết sẽ cập nhật.';
        const action = document.createElement('a');
        action.href = '/buyer.html';
        action.textContent = 'Xem trong khu vực người mua';
        card.append(title, venue, description, action);
        list.appendChild(card);
      }
    })
    .catch(() => {
      message.className = 'message error';
      message.textContent = 'Chưa thể tải sự kiện. Vui lòng thử lại sau.';
    });
})();
