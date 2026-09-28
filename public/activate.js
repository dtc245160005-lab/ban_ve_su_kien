const form = typeof document !== 'undefined' ? document.getElementById('activateForm') : null;
const emailInput = typeof document !== 'undefined' ? document.getElementById('activationEmail') : null;
const codeInput = typeof document !== 'undefined' ? document.getElementById('activationCode') : null;
const codeError = typeof document !== 'undefined' ? document.getElementById('codeError') : null;
const statusBox = typeof document !== 'undefined' ? document.getElementById('statusBox') : null;
const activateButton = typeof document !== 'undefined' ? document.getElementById('activateButton') : null;
const resendButton = typeof document !== 'undefined' ? document.getElementById('resendButton') : null;

function initialEmail() {
  if (typeof window === 'undefined') return '';
  const queryEmail = new URLSearchParams(window.location.search).get('email');
  return queryEmail || sessionStorage.getItem('activationEmail') || '';
}

function showStatus(message, type = 'error') {
  statusBox.textContent = message;
  statusBox.className = `message ${type}`;
  statusBox.hidden = false;
}

if (emailInput) emailInput.value = initialEmail();
if (codeInput) {
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeError.textContent = '';
  });
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const code = codeInput.value.trim();
    statusBox.hidden = true;

    if (!email) {
      showStatus('Vui lòng nhập email.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      codeError.textContent = 'Mã xác nhận phải gồm đúng 6 chữ số.';
      return;
    }

    activateButton.disabled = true;
    activateButton.textContent = 'Đang xác nhận...';
    try {
      const response = await fetch('/api/auth/activate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const result = await response.json();
      if (!response.ok) {
        showStatus(result.message || 'Không thể xác nhận tài khoản.');
        return;
      }
      sessionStorage.removeItem('activationEmail');
      showStatus('Xác nhận thành công. Đang chuyển đến trang đăng nhập...', 'success');
      setTimeout(() => window.location.assign('/login.html?activated=1'), 1000);
    } catch {
      showStatus('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      activateButton.disabled = false;
      activateButton.textContent = 'Xác nhận';
    }
  });
}

if (resendButton) {
  resendButton.addEventListener('click', async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email) {
      showStatus('Vui lòng nhập email trước khi gửi lại mã.');
      return;
    }
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
      showStatus(result.message || 'Nếu tài khoản hợp lệ, mã mới đã được gửi.', 'success');
    } catch {
      showStatus('Không thể gửi lại mã lúc này. Vui lòng thử lại sau.');
    } finally {
      resendButton.disabled = false;
      resendButton.textContent = 'Gửi lại mã';
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initialEmail };
}
