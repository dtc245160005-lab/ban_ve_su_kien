const demoUserId = 42;
const apiBase = "/api/seat-reservations";
const holdDurationMs = 10 * 60 * 1000;
const seats = [
  { id: 10, label: "A1", price: 450000, row: "A" },
  { id: 11, label: "A2", price: 450000, row: "A" },
  { id: 12, label: "A3", price: 450000, row: "A" },
  { id: 13, label: "A4", price: 450000, row: "A" },
  { id: 14, label: "A5", price: 450000, row: "A" },
  { id: 20, label: "B1", price: 350000, row: "B" },
  { id: 21, label: "B2", price: 350000, row: "B" },
  { id: 22, label: "B3", price: 350000, row: "B" },
  { id: 23, label: "B4", price: 350000, row: "B" },
  { id: 24, label: "B5", price: 350000, row: "B" },
  { id: 30, label: "C1", price: 250000, row: "C" },
  { id: 31, label: "C2", price: 250000, row: "C" },
  { id: 32, label: "C3", price: 250000, row: "C" },
  { id: 33, label: "C4", price: 250000, row: "C" },
  { id: 34, label: "C5", price: 250000, row: "C" },
];

const seatMap = document.getElementById("seatMap");
const selectedSeatList = document.getElementById("selectedSeatList");
const countdown = document.getElementById("countdown");
const countdownText = document.getElementById("countdownText");
const statusMessage = document.getElementById("statusMessage");
const selectedSeats = new Set();
const pendingUnholds = new Set();
const unavailableSeats = new Set([20]);
let holdExpiresAt = null;
let countdownInterval = null;

function formatCurrency(amount) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderSeatMap() {
  seatMap.replaceChildren();

  seats.forEach((seat) => {
    const button = document.createElement("button");
    const isHeldByUser = selectedSeats.has(seat.id);
    const isUnavailable = unavailableSeats.has(seat.id);
    button.className = `seat${isHeldByUser ? " owned" : ""}${isUnavailable ? " unavailable" : ""}`;
    button.type = "button";
    button.dataset.seatId = String(seat.id);
    button.textContent = seat.label;
    button.disabled = !isHeldByUser || pendingUnholds.has(seat.id);
    button.setAttribute(
      "aria-label",
      isHeldByUser
        ? `Bỏ chọn ghế ${seat.label}`
        : `${seat.label}, ${isUnavailable ? "đã có người giữ" : "còn trống"}`,
    );
    seatMap.append(button);
  });
}

function renderSelection() {
  selectedSeatList.replaceChildren();

  const currentSeats = seats.filter((seat) => selectedSeats.has(seat.id));
  currentSeats.forEach((seat) => {
    const item = document.createElement("li");
    item.className = "selected-seat";

    const name = document.createElement("span");
    name.className = "seat-name";
    const mini = document.createElement("span");
    mini.className = "seat-mini";
    mini.textContent = seat.label;
    name.append(mini, document.createTextNode(`Hàng ${seat.row}`));

    const price = document.createElement("span");
    price.className = "seat-price";
    price.textContent = formatCurrency(seat.price);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-seat";
    removeButton.type = "button";
    removeButton.dataset.removeSeatId = String(seat.id);
    removeButton.textContent = "×";
    removeButton.disabled = pendingUnholds.has(seat.id);
    removeButton.setAttribute("aria-label", `Bỏ chọn ghế ${seat.label}`);

    item.append(name, price, removeButton);
    selectedSeatList.append(item);
  });

  document.getElementById("seatCount").textContent = String(currentSeats.length);
  document.getElementById("estimatedTotal").textContent = formatCurrency(
    currentSeats.reduce((total, seat) => total + seat.price, 0),
  );
  document.getElementById("emptyState").hidden = currentSeats.length > 0;
  renderSeatMap();

  if (currentSeats.length === 0) {
    stopCountdown();
  }
}

function startCountdown() {
  stopCountdown();
  if (selectedSeats.size === 0 || !holdExpiresAt) return;

  countdown.hidden = false;
  const updateCountdown = () => {
    const remaining = Math.max(0, holdExpiresAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    countdownText.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;

    if (remaining === 0) {
      selectedSeats.clear();
      holdExpiresAt = null;
      stopCountdown();
      renderSelection();
    }
  };

  updateCountdown();
  countdownInterval = window.setInterval(updateCountdown, 1000);
}

function stopCountdown() {
  if (countdownInterval !== null) {
    window.clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdown.hidden = true;
  countdownText.textContent = "";
}

async function releaseSeat(seatId) {
  if (!selectedSeats.has(seatId) || pendingUnholds.has(seatId)) return;

  const previousExpiry = holdExpiresAt;
  pendingUnholds.add(seatId);
  selectedSeats.delete(seatId);
  statusMessage.textContent = "";
  renderSelection();

  try {
    const response = await fetch(`${apiBase}/${seatId}`, {
      method: "DELETE",
      headers: { "X-Demo-User-Id": String(demoUserId) },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Không thể bỏ giữ ghế. Vui lòng thử lại.");
    }

    unavailableSeats.delete(seatId);
  } catch (error) {
    selectedSeats.add(seatId);
    holdExpiresAt = previousExpiry > Date.now() ? previousExpiry : Date.now() + holdDurationMs;
    statusMessage.textContent = error.message || "Không thể kết nối đến máy chủ.";
    if (selectedSeats.size > 0) startCountdown();
  } finally {
    pendingUnholds.delete(seatId);
    renderSelection();
  }
}

seatMap.addEventListener("click", (event) => {
  const button = event.target.closest("[data-seat-id]");
  if (button) releaseSeat(Number(button.dataset.seatId));
});

selectedSeatList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-seat-id]");
  if (button) releaseSeat(Number(button.dataset.removeSeatId));
});

async function loadHeldSeats() {
  seatMap.classList.add("loading");
  try {
    const response = await fetch(`${apiBase}/mine`, {
      headers: { "X-Demo-User-Id": String(demoUserId) },
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Không tải được danh sách ghế.");
    }

    data.seatIds.forEach((seatId) => selectedSeats.add(Number(seatId)));
    if (selectedSeats.size > 0) {
      holdExpiresAt = Date.now() + holdDurationMs;
      startCountdown();
    }
    renderSelection();
  } catch (error) {
    statusMessage.textContent = error.message || "Không thể kết nối đến máy chủ.";
    renderSelection();
  } finally {
    seatMap.classList.remove("loading");
  }
}

renderSelection();
loadHeldSeats();