(function (global) {
  const MENU_ITEMS = {
    EVENT_MANAGEMENT: 'Quản lý sự kiện',
    RECONCILIATION: 'Đối soát',
    TICKET_CHECK: 'Soát vé',
    BUYER_TICKETS: 'Vé của tôi',
  };

  function visibleMenus(roles) {
    if (!Array.isArray(roles)) {
      return [];
    }

    const items = [];
    const isOrganizer = roles.includes('organizer');
    const isAccountant = roles.includes('accountant');
    const isAdmin = roles.includes('admin');

    if (isOrganizer || isAdmin) {
      items.push(MENU_ITEMS.EVENT_MANAGEMENT);
    }

    if (isAccountant || isAdmin) {
      items.push(MENU_ITEMS.RECONCILIATION);
    }

    if (roles.includes('checker') || isAdmin) {
      items.push(MENU_ITEMS.TICKET_CHECK);
    }

    if (roles.includes('buyer')) {
      items.push(MENU_ITEMS.BUYER_TICKETS);
    }

    return items;
  }

  global.visibleMenus = visibleMenus;
  global.MENU_ITEMS = MENU_ITEMS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      visibleMenus,
      MENU_ITEMS,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
