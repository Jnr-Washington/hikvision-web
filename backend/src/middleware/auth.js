import jwt from 'jsonwebtoken';
import cookie from 'cookie-parser';

/**
 * Parse cookies from a raw Cookie header string (used on HTTP upgrade requests).
 * @param {string|undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookieHeader(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

/**
 * Sign a short-lived JWT session token for an authenticated user.
 */
export function signAuthToken(user, config) {
  return jwt.sign(
    { sub: user.username, role: 'viewer' },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenTtl },
  );
}

/**
 * Verify a JWT token and return its decoded payload or null if invalid/expired.
 */
export function verifyAuthToken(token, config) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Cookie options shared across login and logout responses.
 */
export function getAuthCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
}

/**
 * Express middleware verifying the JWT session cookie.
 */
export function createAuthMiddleware(config) {
  return function requireAuth(req, res, next) {
    const token = req.cookies?.[config.auth.cookieName];
    const payload = verifyAuthToken(token, config);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = { username: payload.sub, role: payload.role };
    return next();
  };
}

/**
 * Verify JWT cookie on raw Node HTTP Upgrade requests (e.g. WebSocket /stream/api/ws).
 */
export function verifyUpgradeAuth(req, config) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const token = cookies[config.auth.cookieName];
  return verifyAuthToken(token, config);
}

export { cookie as cookieParser };
