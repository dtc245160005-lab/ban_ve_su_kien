(function () {
  const mount = document.getElementById('siteHeader');
  if (!mount) return;
  const ticketIcon = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M7 12.5 32 4l3.3 5.5a5 5 0 0 0 5.8 8.7L45 25 20 43l-4.1-6.2a5 5 0 0 0-6.9-7.3L4 22l5.1-4.3A5 5 0 0 0 7 12.5Z" fill="currentColor"/><path d="m18 13 12 19M22 11l12 19" stroke="white" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 4"/></svg>';

  const linksByRole = {
    organizer: [
      ['/organizer-events.html', 'Tổng quan'],
      ['/organizer-events.html#events', 'Sự kiện của tôi'],
      ['/organizer-events.html#create', 'Tạo sự kiện'],
    ],
    buyer: [
      ['/home.html', 'Trang chủ'],
      ['/home.html#events', 'Sự kiện'],
      ['/buyer.html', 'Khu vực người mua'],
    ],
  };

  function link(url, label) {
    const item = document.createElement('a');
    item.href = url;
    item.textContent = label;
    const [pathname, anchor] = url.split('#');
    if (window.location.pathname === pathname && (!anchor || window.location.hash === `#${anchor}`)) {
      item.setAttribute('aria-current', 'page');
    }
    return item;
  }

  function render(roles = []) {
    mount.className = 'site-header';
    mount.innerHTML = `<div class="site-header-inner"><a class="site-brand" href="/home.html" aria-label="Vé Sự Kiện - Trang chủ"><span class="site-brand-mark">${ticketIcon}</span><span>Vé Sự Kiện</span></a><button class="nav-toggle" type="button" aria-label="Mở menu" aria-expanded="false" aria-controls="siteNav">☰</button><nav id="siteNav" class="site-nav" aria-label="Điều hướng chính"><div class="site-nav-links"></div><div class="site-nav-actions"></div></nav></div>`;
    const nav = mount.querySelector('.site-nav');
    const navLinks = mount.querySelector('.site-nav-links');
    const navActions = mount.querySelector('.site-nav-actions');
    const isAdmin = roles.includes('admin');
    const links = roles.includes('organizer') || isAdmin
      ? linksByRole.organizer
      : roles.includes('buyer') ? linksByRole.buyer : [
        ['/home.html', 'Trang chủ'],
        ['/home.html#events', 'Sự kiện'],
        ['/home.html#about', 'Về chúng tôi'],
        ['/home.html#help', 'Hỗ trợ'],
      ];
    links.forEach(([url, label]) => navLinks.appendChild(link(url, label)));
    if (isAdmin) navLinks.appendChild(link('/admin-staff.html', 'Nhân viên'));
    if (roles.length) {
      navActions.appendChild(link('/app.html', 'Tài khoản'));
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'nav-logout';
      logout.textContent = 'Đăng xuất';
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
        finally { window.location.assign('/login.html'); }
      });
      navActions.appendChild(logout);
    } else {
      const login = link('/login.html', 'Đăng nhập');
      login.className = 'nav-login';
      const register = link('/register.html', 'Đăng ký');
      register.className = 'nav-register';
      navActions.append(login, register);
    }
    const toggle = mount.querySelector('.nav-toggle');
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    });
  }

  render();
  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((result) => {
      if (result) render(Array.isArray(result.user?.roles) ? result.user.roles : []);
    })
    .catch(() => {});
})();
