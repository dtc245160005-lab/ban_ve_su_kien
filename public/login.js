const form = typeof document !== 'undefined' ? document.getElementById('loginForm') : null;
const emailInput = typeof document !== 'undefined' ? document.getElementById('email') : null;
const passwordInput = typeof document !== 'undefined' ? document.getElementById('password') : null;
const messageBox = typeof document !== 'undefined' ? document.getElementById('messageBox') : null;
const submitButton = typeof document !== 'undefined' ? document.getElementById('submitButton') : null;
const submitLabel = typeof document !== 'undefined' ? document.getElementById('submitLabel') : null;
const emailError = typeof document !== 'undefined' ? document.getElementById('emailError') : null;
const passwordError = typeof document !== 'undefined' ? document.getElementById('passwordError') : null;
const togglePassword = typeof document !== 'undefined' ? document.getElementById('togglePassword') : null;

function roleHome(roles) {
  if (!Array.isArray(roles)) return '/app.html';
  if (roles.includes('admin')) return '/admin-staff.html';
  if (roles.includes('organizer')) return '/organizer-events.html';
  if (roles.includes('buyer')) return '/buyer.html';
  if (roles.includes('checker')) return '/checker.html';
  if (roles.includes('accountant')) return '/accountant.html';
  return '/app.html';
}

function updateSubmitState() {
  if (submitButton) submitButton.disabled = !emailInput.value.trim() || !passwordInput.value;
}

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

function showAccountNotActive(message, email) {
  if (!messageBox) return;
  messageBox.innerHTML = '';
  messageBox.className = 'message error';

  const textP = document.createElement('p');
  textP.textContent = message;
  messageBox.appendChild(textP);

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.className = 'secondary-btn resend-activation-btn';
  resendBtn.textContent = 'Gửi lại mã xác nhận';

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Đang gửi...';
    try {
      const res = await fetch('/api/auth/resend-activation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Resend unavailable');
      await res.json();
      messageBox.className = 'message success';
      sessionStorage.setItem('activationEmail', email.toLowerCase());
      window.location.assign(`/activate.html?email=${encodeURIComponent(email.toLowerCase())}`);
    } catch {
      messageBox.className = 'message error';
      messageBox.textContent = 'Không thể gửi lại mã lúc này. Vui lòng thử lại sau.';
    }
  });

  messageBox.appendChild(resendBtn);
  messageBox.hidden = false;
}

if (form) {
  emailInput.addEventListener('input', () => {
    emailError.textContent = '';
    updateSubmitState();
  });
  passwordInput.addEventListener('input', () => {
    passwordError.textContent = '';
    updateSubmitState();
  });
  togglePassword?.addEventListener('click', () => {
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    togglePassword.setAttribute('aria-pressed', String(visible));
    togglePassword.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  updateSubmitState();
  window.addEventListener('pageshow', updateSubmitState);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage('Vui lòng nhập email và mật khẩu.');
      return;
    }
    if (!emailInput.validity.valid) {
      emailError.textContent = 'Email không đúng định dạng.';
      return;
    }

    submitButton.disabled = true;
    submitLabel.textContent = 'Đang đăng nhập...';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.code === 'ACCOUNT_NOT_ACTIVE') {
          showAccountNotActive(
            result.message || 'Tài khoản chưa được kích hoạt.',
            email
          );
        } else {
          const wait = response.status === 429 && Number.isFinite(Number(result.retryAfterSeconds))
            ? ` Vui lòng thử lại sau ${Math.ceil(Number(result.retryAfterSeconds) / 60)} phút.` : '';
          showMessage((result.message || 'Không thể đăng nhập. Vui lòng thử lại.') + wait);
        }
        return;
      }

      const redirectTarget = getSafeRedirectUrl(roleHome(result.user?.roles));
      window.location.assign(redirectTarget);
    } catch {
      showMessage('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      submitButton.disabled = false;
      submitLabel.textContent = 'Đăng nhập';
      updateSubmitState();
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSafeRedirectUrl, roleHome };
}
