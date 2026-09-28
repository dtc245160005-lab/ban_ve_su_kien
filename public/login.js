const form = typeof document !== 'undefined' ? document.getElementById('loginForm') : null;
const emailInput = typeof document !== 'undefined' ? document.getElementById('email') : null;
const passwordInput = typeof document !== 'undefined' ? document.getElementById('password') : null;
const messageBox = typeof document !== 'undefined' ? document.getElementById('messageBox') : null;
const submitButton = typeof document !== 'undefined' ? document.getElementById('submitButton') : null;

function showMessage(message) {
  messageBox.textContent = message;
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.textContent = '';
  messageBox.hidden = true;
}

function getSafeRedirectUrl(fallback = '/app.html') {
  if (typeof window === 'undefined' || !window.location) {
    return fallback;
  }
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
    return next;
  }
  return fallback;
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage('Vui lòng nhập email và mật khẩu.');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Đang đăng nhập...';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (!response.ok) {
        showMessage(result.message || 'Không thể đăng nhập. Vui lòng thử lại.');
        return;
      }

      const redirectTarget = getSafeRedirectUrl(result.redirectTo || '/app.html');
      window.location.assign(redirectTarget);
    } catch {
      showMessage('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Đăng nhập';
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSafeRedirectUrl };
}
