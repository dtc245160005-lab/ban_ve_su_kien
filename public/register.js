/* global validateRegisterForm */
const form = typeof document !== 'undefined' ? document.getElementById('registerForm') : null;
const fullNameInput = typeof document !== 'undefined' ? document.getElementById('fullName') : null;
const emailInput = typeof document !== 'undefined' ? document.getElementById('email') : null;
const passwordInput = typeof document !== 'undefined' ? document.getElementById('password') : null;
const confirmPasswordInput = typeof document !== 'undefined' ? document.getElementById('confirmPassword') : null;
const fullNameError = typeof document !== 'undefined' ? document.getElementById('fullNameError') : null;
const emailError = typeof document !== 'undefined' ? document.getElementById('emailError') : null;
const passwordError = typeof document !== 'undefined' ? document.getElementById('passwordError') : null;
const confirmPasswordError = typeof document !== 'undefined' ? document.getElementById('confirmPasswordError') : null;
const successBox = typeof document !== 'undefined' ? document.getElementById('successBox') : null;
const messageBox = typeof document !== 'undefined' ? document.getElementById('messageBox') : null;
const submitButton = typeof document !== 'undefined' ? document.getElementById('submitButton') : null;

function clearErrors() {
  if (fullNameError) fullNameError.textContent = '';
  if (emailError) emailError.textContent = '';
  if (passwordError) passwordError.textContent = '';
  if (confirmPasswordError) confirmPasswordError.textContent = '';
  if (messageBox) {
    messageBox.textContent = '';
    messageBox.hidden = true;
  }
}

function updateRegisterState() {
  if (!form) return;
  submitButton.disabled = !fullNameInput.value.trim() || !emailInput.validity.valid || !emailInput.value.trim() ||
    passwordInput.value.length < 8 || passwordInput.value !== confirmPasswordInput.value;
}

function showFieldErrors(errors = {}) {
  if (errors.full_name && fullNameError) {
    fullNameError.textContent = errors.full_name;
  }
  if (errors.email && emailError) {
    emailError.textContent = errors.email;
  }
  if (errors.password && passwordError) {
    passwordError.textContent = errors.password;
  }
}

if (form) {
  form.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
    const errors = validateRegisterForm({
      full_name: fullNameInput.value, email: emailInput.value, password: passwordInput.value,
    }).errors;
    fullNameError.textContent = fullNameInput.value ? errors.full_name || '' : '';
    emailError.textContent = emailInput.value ? errors.email || '' : '';
    passwordError.textContent = passwordInput.value ? errors.password || '' : '';
    confirmPasswordError.textContent = confirmPasswordInput.value && confirmPasswordInput.value !== passwordInput.value
      ? 'Mật khẩu xác nhận không khớp.' : '';
    updateRegisterState();
  }));
  if (passwordInput) {
    passwordInput.addEventListener('blur', () => {
      const validation = typeof validateRegisterForm === 'function'
        ? validateRegisterForm({ password: passwordInput.value })
        : { errors: {} };
      if (passwordInput.value.length < 8) {
        if (passwordError) {
          passwordError.textContent = validation.errors.password || 'Mật khẩu phải từ 8 đến 128 ký tự.';
        }
      } else if (!validation.errors.password) {
        if (passwordError) {
          passwordError.textContent = '';
        }
      }
    });
  }
  form.querySelectorAll('.password-toggle').forEach((button) => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  }));
  updateRegisterState();
  window.addEventListener('pageshow', updateRegisterState);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const full_name = fullNameInput ? fullNameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    // Kiểm tra dữ liệu phía trình duyệt
    const validation = typeof validateRegisterForm === 'function'
      ? validateRegisterForm({ email, password, full_name })
      : { valid: true, errors: {} };

    if (!validation.valid) {
      showFieldErrors(validation.errors);
      return;
    }
    if (password !== confirmPasswordInput.value) {
      confirmPasswordError.textContent = 'Mật khẩu xác nhận không khớp.';
      return;
    }

    // Chặn bấm gửi hai lần
    submitButton.disabled = true;
    submitButton.textContent = 'Đang xử lý...';

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name }),
      });

      const result = await response.json();

      if (response.status === 400 && result.errors) {
        showFieldErrors(result.errors);
        return;
      }

      if (response.status === 202) {
        sessionStorage.setItem('activationEmail', email.toLowerCase());
        form.hidden = true;
        successBox.hidden = false;
        successBox.innerHTML = '<strong>Kiểm tra email của bạn</strong><p>Nếu email hợp lệ, mã xác nhận đã được gửi đến hộp thư. Hãy nhập mã để kích hoạt tài khoản.</p>';
        const link = document.createElement('a');
        link.href = `/activate.html?email=${encodeURIComponent(email.toLowerCase())}`;
        link.textContent = 'Nhập mã xác nhận';
        successBox.appendChild(link);
        return;
      }

      if (messageBox) {
        messageBox.textContent = result.message || 'Không thể đăng ký. Vui lòng thử lại.';
        messageBox.hidden = false;
      }
    } catch {
      if (messageBox) {
        messageBox.textContent = 'Không thể kết nối máy chủ. Vui lòng thử lại sau.';
        messageBox.hidden = false;
      }
    } finally {
      if (!form.hidden) {
        submitButton.disabled = false;
        submitButton.textContent = 'Tạo tài khoản';
        updateRegisterState();
      }
    }
  });
}
