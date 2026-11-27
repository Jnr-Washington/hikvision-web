import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {
  getAuthCookieOptions,
  signAuthToken,
  verifyAuthToken,
} from '../middleware/auth.js';

export function createAuthRouter(config) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.nodeEnv === 'test' ? 200 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later.' },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userMatches = username === config.auth.adminUser;
    const passMatches = userMatches
      ? await bcrypt.compare(password, config.auth.adminPassHash)
      : false;

    if (!userMatches || !passMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAuthToken({ username }, config);
    res.cookie(config.auth.cookieName, token, getAuthCookieOptions(config));
    return res.json({ user: { username, role: 'viewer' } });
  });

  router.post('/logout', (req, res) => {
    const opts = getAuthCookieOptions(config);
    res.clearCookie(config.auth.cookieName, {
      httpOnly: opts.httpOnly,
      sameSite: opts.sameSite,
      secure: opts.secure,
      path: opts.path,
    });
    return res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const token = req.cookies?.[config.auth.cookieName];
    const payload = verifyAuthToken(token, config);
    if (!payload) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.json({ user: { username: payload.sub, role: payload.role } });
  });

  return router;
}
