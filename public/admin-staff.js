/* global apiFetch */
const form = document.getElementById('staffForm');
const list = document.getElementById('staffList');
const message = document.getElementById('staffMessage');

function showMessage(text, type = 'error') { message.textContent = text; message.className = `message ${type}`; message.hidden = false; }

async function loadStaff() {
  const response = await apiFetch('/api/workspaces/admin/staff');
  const result = await response.json();
  if (!response.ok) return showMessage(result.message || 'Không thể tải danh sách nhân viên.');
  list.innerHTML = result.data.length ? result.data.map((user) => `
    <article class="staff-row"><div><strong>${escapeText(user.full_name || user.email)}</strong><small>${escapeText(user.email)} · ${user.roles.map(roleLabel).join(', ')}</small></div>
    <button class="${user.is_active ? 'danger-btn' : 'secondary-btn'} small-btn" data-id="${user.id}" data-active="${!user.is_active}">${user.is_active ? 'Khóa' : 'Mở khóa'}</button></article>`).join('') : '<p>Chưa có nhân viên.</p>';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roles = [...form.querySelectorAll('input[name="roles"]:checked')].map((input) => input.value);
  const response = await apiFetch('/api/workspaces/admin/staff', { method: 'POST', body: JSON.stringify({ full_name: form.fullName.value.trim(), email: form.email.value.trim(), password: form.password.value, roles }) });
  const result = await response.json();
  if (!response.ok) return showMessage(result.message || 'Không thể tạo nhân viên.');
  form.reset(); showMessage('Đã tạo nhân viên thành công.', 'success'); await loadStaff();
});

list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const response = await apiFetch(`/api/workspaces/admin/staff/${button.dataset.id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: button.dataset.active === 'true' }) });
  const result = await response.json();
  if (!response.ok) return showMessage(result.message || 'Không thể cập nhật nhân viên.');
  await loadStaff();
});

function roleLabel(role) { return ({ organizer: 'Ban tổ chức', checker: 'Soát vé', accountant: 'Kế toán' })[role] || role; }
function escapeText(value) { const node = document.createElement('div'); node.textContent = String(value || ''); return node.innerHTML; }
loadStaff().catch(() => showMessage('Không thể kết nối máy chủ.'));
