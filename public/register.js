/* global validateRegisterForm */
const form = typeof document !== 'undefined' ? document.getElementById('registerForm') : null;
const fullNameInput = typeof document !== 'undefined' ? document.getElementById('fullName') : null;
const emailInput = typeof document !== 'undefined' ? document.getElementById('email') : null;
const passwordInput = typeof document !== 'undefined' ? document.getElementById('password') : null;
const fullNameError = typeof document !== 'undefined' ? document.getElementById('fullNameError') : null;
const emailError = typeof document !== 'undefined' ? document.getElementById('emailError') : null;
const passwordError = typeof document !== 'undefined' ? document.getElementById('passwordError') : null;
const messageBox = typeof document !== 'undefined' ? document.getElementById('messageBox') : null;
const submitButton = typeof document !== 'undefined' ? document.getElementById('submitButton') : null;

function clearErrors() {
  if (fullNameError) fullNameError.textContent = '';
  if (emailError) emailError.textContent = '';
  if (passwordError) passwordError.textContent = '';
  if (messageBox) {
    messageBox.textContent = '';
    messageBox.hidden = true;
  }
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
        window.location.assign(`/activate.html?email=${encodeURIComponent(email.toLowerCase())}`);
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
        submitButton.textContent = 'Đăng ký';
      }
    }
  });
}
