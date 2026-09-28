const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const messageBox = document.getElementById('messageBox');
const submitButton = document.getElementById('submitButton');

function showMessage(message) {
  messageBox.textContent = message;
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.textContent = '';
  messageBox.hidden = true;
}

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

    window.location.assign(result.redirectTo || '/app.html');
  } catch {
    showMessage('Không thể kết nối máy chủ. Vui lòng thử lại.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Đăng nhập';
  }
});
