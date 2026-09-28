const defaultAuthenticate = require('./authenticate');

const routeRegistry = {
  logger: console,
};

function logForbidden({ userId = null, method, path, at = new Date().toISOString() }) {
  const payload = {
    event: 'forbidden',
    userId: userId !== undefined && userId !== null ? userId : null,
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    at,
  };

  const line = JSON.stringify(payload);
  const currentLogger = routeRegistry.logger || console;
  if (typeof currentLogger.warn === 'function') {
    currentLogger.warn(line);
  } else if (typeof currentLogger.log === 'function') {
    currentLogger.log(line);
  }

  return payload;
}

function sendForbidden(req, res, customMessage) {
  const userId = req.user?.id || null;
  const method = req.method;
  const path = req.originalUrl || (req.baseUrl ? req.baseUrl + req.path : req.path);

  logForbidden({ userId, method, path });

  return res.status(403).json({
    success: false,
    message: customMessage || 'Bạn không có quyền thực hiện thao tác này.',
  });
}

function apiFallbackForbidden(req, res) {
  const userId = req.user?.id || null;
  const method = req.method;
  const path = req.originalUrl || (req.baseUrl ? req.baseUrl + req.path : req.path);

  logForbidden({ userId, method, path });

  return res.status(403).json({
    success: false,
    message: 'Truy cập bị từ chối.',
  });
}

function secure(router, method, path, permission, ...handlers) {
  if (!router) {
    throw new Error('Router or App instance is required');
  }

  if (typeof method !== 'string') {
    throw new Error('HTTP method must be a string');
  }

  const normalizedMethod = method.toLowerCase();
  if (typeof router[normalizedMethod] !== 'function') {
    throw new Error(`Invalid or unsupported HTTP method: ${method}`);
  }

  if (!path || typeof path !== 'string') {
    throw new Error('Route path must be a non-empty string');
  }

  if (handlers.length === 0) {
    throw new Error(`At least one handler is required for ${method.toUpperCase()} ${path}`);
  }

  const isPublic = permission === 'public';
  const isAuthenticated = permission === 'authenticated';
  const isRoleBased =
    permission &&
    typeof permission === 'object' &&
    Array.isArray(permission.roles) &&
    permission.roles.length > 0;

  if (!isPublic && !isAuthenticated && !isRoleBased) {
    throw new Error(
      `Invalid permission for ${method.toUpperCase()} ${path}. Expected 'public', 'authenticated', or { roles: [...] }`
    );
  }

  const middlewares = [];

  if (isPublic) {
    middlewares.push(...handlers);
  } else if (isAuthenticated) {
    middlewares.push(defaultAuthenticate, ...handlers);
  } else if (isRoleBased) {
    const requiredRoles = permission.roles;
    const roleCheck = (req, res, next) => {
      const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const hasPermission = userRoles.some((role) => requiredRoles.includes(role));

      if (!hasPermission) {
        return sendForbidden(req, res);
      }

      return next();
    };

    middlewares.push(defaultAuthenticate, roleCheck, ...handlers);
  }

  router[normalizedMethod](path, ...middlewares);

  // Gắn đánh dấu _secured trên route vừa tạo
  const stack = router.stack || router.router?.stack;
  if (Array.isArray(stack) && stack.length > 0) {
    const lastLayer = stack[stack.length - 1];
    if (lastLayer && lastLayer.route) {
      lastLayer.route._secured = true;
      lastLayer.route._permission = permission;
    }
  }

  return router;
}

function findUnsecuredApiRoutes(app) {
  const router = app.router || app._router;
  if (!router || !Array.isArray(router.stack)) {
    return [];
  }

  const unsecured = [];

  function scan(stack, prefix = '') {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path || '';
        const fullPath = (prefix + (routePath.startsWith('/') ? routePath : '/' + routePath)).replace(/\/+/g, '/');
        if (fullPath.startsWith('/api') || prefix.startsWith('/api')) {
          if (!layer.route._secured) {
            unsecured.push({
              path: fullPath,
              methods: Object.keys(layer.route.methods || {}),
              route: layer.route,
            });
          }
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        let subPrefix = prefix;
        if (layer.handle._mountPrefix) {
          subPrefix = (prefix + layer.handle._mountPrefix).replace(/\/+/g, '/');
        } else if (layer.matchers && layer.matchers.length) {
          for (const testCandidate of ['/api/auth', '/api/events', '/api']) {
            const m = layer.matchers[0](testCandidate);
            if (m && m.path) {
              subPrefix = (prefix + m.path).replace(/\/+/g, '/');
              break;
            }
          }
        }
        scan(layer.handle.stack, subPrefix);
      }
    }
  }

  scan(router.stack);
  return unsecured;
}

routeRegistry.secure = secure;
routeRegistry.logForbidden = logForbidden;
routeRegistry.sendForbidden = sendForbidden;
routeRegistry.apiFallbackForbidden = apiFallbackForbidden;
routeRegistry.findUnsecuredApiRoutes = findUnsecuredApiRoutes;

module.exports = routeRegistry;
