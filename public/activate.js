const statusSubtitle = typeof document !== 'undefined' ? document.getElementById('statusSubtitle') : null;
const statusBox = typeof document !== 'undefined' ? document.getElementById('statusBox') : null;
const actionArea = typeof document !== 'undefined' ? document.getElementById('actionArea') : null;
const resendForm = typeof document !== 'undefined' ? document.getElementById('resendForm') : null;
const resendEmail = typeof document !== 'undefined' ? document.getElementById('resendEmail') : null;
const resendButton = typeof document !== 'undefined' ? document.getElementById('resendButton') : null;

function getTokenFromUrl() {
  if (typeof window === 'undefined' || !window.location) return null;

  // 1. Ưu tiên đọc từ hash (#token=...)
  if (window.location.hash) {
    const hash = window.location.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    const tokenFromHash = hashParams.get('token');
    if (tokenFromHash) return tokenFromHash;
  }

  // 2. Đọc từ query string (?token=...)
  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get('token');
}

function clearTokenFromAddressBar() {
  if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function renderStatus({ type, message, showLogin = false, showResend = false }) {
  if (statusSubtitle) {
    statusSubtitle.textContent = type === 'success' ? 'Hoàn tất kích hoạt' : 'Trạng thái kích hoạt';
  }

  if (statusBox) {
    statusBox.className = `message ${type}`;
    statusBox.textContent = message;
    statusBox.hidden = false;
  }

  if (actionArea) {
    actionArea.innerHTML = '';
    if (showLogin) {
      const loginBtn = document.createElement('a');
      loginBtn.href = '/login.html';
      loginBtn.className = 'primary-btn';
      loginBtn.style.textAlign = 'center';
      loginBtn.style.textDecoration = 'none';
      loginBtn.style.display = 'block';
      loginBtn.textContent = 'Đăng nhập ngay';
      actionArea.appendChild(loginBtn);
    }
  }

  if (resendForm) {
    resendForm.hidden = !showResend;
  }
}

async function performActivation() {
  const token = getTokenFromUrl();
  clearTokenFromAddressBar();

  if (!token) {
    renderStatus({
      type: 'error',
      message: 'Không tìm thấy mã kích hoạt trong đường dẫn.',
      showResend: true,
    });
    return;
  }

  try {
    const response = await fetch('/api/auth/activate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const result = await response.json();

    if (response.status === 200) {
      renderStatus({
        type: 'success',
        message: result.message || 'Tài khoản đã được kích hoạt thành công.',
        showLogin: true,
      });
      return;
    }

    if (response.status === 409) {
      renderStatus({
        type: 'error',
        message: result.message || 'Liên kết đã được sử dụng.',
        showLogin: true,
      });
      return;
    }

    if (response.status === 410) {
      renderStatus({
        type: 'error',
        message: result.message || 'Liên kết đã hết hạn.',
        showResend: true,
      });
      return;
    }

    renderStatus({
      type: 'error',
      message: result.message || 'Mã kích hoạt không hợp lệ.',
      showResend: true,
    });
  } catch {
    renderStatus({
      type: 'error',
      message: 'Không thể kết nối đến máy chủ. Vui lòng thử lại sau.',
      showResend: true,
    });
  }
}

if (resendForm) {
  resendForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = resendEmail ? resendEmail.value.trim() : '';

    if (!email) return;

    resendButton.disabled = true;
    resendButton.textContent = 'Đang gửi...';

    try {
      const response = await fetch('/api/auth/resend-activation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();
      renderStatus({
        type: 'success',
        message: result.message || 'Nếu email hợp lệ và chưa kích hoạt, bạn sẽ nhận được hướng dẫn trong hộp thư.',
        showResend: false,
        showLogin: true,
      });
    } catch {
      renderStatus({
        type: 'error',
        message: 'Không thể gửi lại email lúc này. Vui lòng thử lại sau.',
        showResend: true,
      });
    } finally {
      resendButton.disabled = false;
      resendButton.textContent = 'Gửi lại email kích hoạt';
    }
  });
}

if (typeof window !== 'undefined') {
  performActivation();
}
