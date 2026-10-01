const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { roleHome } = require('../public/login');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
}

test('login redirects to the existing workspace for each role', () => {
  assert.equal(roleHome(['organizer']), '/organizer-events.html');
  assert.equal(roleHome(['buyer']), '/buyer.html');
  assert.equal(roleHome(['admin']), '/admin-staff.html');
  assert.equal(roleHome(['admin', 'organizer']), '/admin-staff.html');
  assert.equal(roleHome(['checker']), '/checker.html');
  assert.equal(roleHome(['accountant']), '/accountant.html');
});

test('registration checks matching passwords and uses the existing activation API flow', async () => {
  const dom = new JSDOM(source('register.html'), {
    runScripts: 'outside-only', url: 'http://localhost/register.html',
  });
  const { window } = dom;
  const requests = [];
  window.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { status: 202, json: async () => ({ success: true }) };
  };
  window.eval(source('registerForm.js'));
  window.eval(source('register.js'));
  function fill(id, value) {
    const input = window.document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  fill('fullName', 'Nguyễn Văn A');
  fill('email', 'buyer@example.test');
  fill('password', 'Password123!');
  fill('confirmPassword', 'mismatch');
  assert.equal(window.document.getElementById('submitButton').disabled, true);
  assert.match(window.document.getElementById('confirmPasswordError').textContent, /không khớp/);
  fill('confirmPassword', 'Password123!');
  assert.equal(window.document.getElementById('submitButton').disabled, false);
  window.document.getElementById('registerForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 30 && window.document.getElementById('successBox').hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/auth/register');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['email', 'full_name', 'password']);
  assert.equal(window.document.getElementById('successBox').hidden, false);
  assert.match(window.document.querySelector('#successBox a').getAttribute('href'), /activate\.html/);
  dom.window.close();
});

test('shared header renders public links without a session', async () => {
  const dom = new JSDOM('<!doctype html><div id="siteHeader"></div>', {
    runScripts: 'outside-only', url: 'http://localhost/home.html',
  });
  dom.window.fetch = async () => ({ ok: false });
  dom.window.eval(source('site-header.js'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const links = [...dom.window.document.querySelectorAll('.site-nav a')].map((item) => item.textContent);
  assert.ok(links.includes('Đăng nhập'));
  assert.ok(links.includes('Đăng ký'));
  assert.ok(links.includes('Về chúng tôi'));
  assert.ok(links.includes('Hỗ trợ'));
  assert.equal(dom.window.document.querySelector('.site-brand-mark').textContent, '');
  assert.ok(dom.window.document.querySelector('.site-brand-mark svg'));
  dom.window.close();
});

test('login page keeps only supported email/password sign-in and toggles password visibility', () => {
  const dom = new JSDOM(source('login.html'), {
    runScripts: 'outside-only', url: 'http://localhost/login.html',
  });
  const { document } = dom.window;
  assert.equal(document.querySelector('.login-card .brand-icon'), null);
  assert.doesNotMatch(document.body.textContent, /Tiếp tục với Google|Quên mật khẩu\?|Ghi nhớ đăng nhập/);
  assert.equal(document.querySelectorAll('.login-card .input-icon svg').length, 2);
  assert.equal(document.getElementById('submitButton').disabled, true);
  dom.window.eval(source('login.js'));
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  email.value = 'buyer@example.test';
  email.dispatchEvent(new dom.window.Event('input'));
  password.value = 'Password123!';
  password.dispatchEvent(new dom.window.Event('input'));
  assert.equal(document.getElementById('submitButton').disabled, false);
  document.getElementById('togglePassword').click();
  assert.equal(password.type, 'text');
  document.getElementById('togglePassword').click();
  assert.equal(password.type, 'password');
  dom.window.close();
});
