const ALLOWED_FIELDS = ['event', 'userId', 'method', 'path', 'status', 'at', 'reason', 'count'];
const SENSITIVE_KEYWORDS = ['email', 'password', 'token', 'cookie', 'authorization'];

function sanitizePath(path) {
  if (typeof path !== 'string') return '';
  return path.split('?')[0].split('#')[0];
}

function isSensitiveKey(key) {
  const lower = String(key || '').toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

const logger = {
  sink: null,
};

function logEvent(name, fields = {}) {
  const rawEvent = fields.event || name || 'event';
  const rawPath =
    fields.path ||
    (fields.req?.path
      ? (fields.req.baseUrl ? fields.req.baseUrl + fields.req.path : fields.req.path)
      : '');

  const merged = {
    ...fields,
    event: rawEvent,
    path: sanitizePath(rawPath),
    at: fields.at || new Date().toISOString(),
  };

  if (fields.userId !== undefined) {
    merged.userId = fields.userId !== null ? fields.userId : null;
  }

  if (fields.method) {
    merged.method = String(fields.method).toUpperCase();
  }

  const payload = {};
  for (const key of ALLOWED_FIELDS) {
    if (isSensitiveKey(key)) continue;
    if (merged[key] !== undefined) {
      payload[key] = merged[key];
    }
  }

  const line = JSON.stringify(payload);
  if (typeof logger.sink === 'function') {
    logger.sink(line);
  } else {
    console.warn(line);
  }

  return payload;
}

logger.logEvent = logEvent;
logger.sanitizePath = sanitizePath;

module.exports = logger;
module.exports.logEvent = logEvent;
