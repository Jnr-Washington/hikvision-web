import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import express from 'express';
import helmet from 'helmet';

import { loadConfig, loadEnvFiles } from './config.js';
import { cookieParser, createAuthMiddleware } from './middleware/auth.js';
import { createHikvisionClient } from './services/hikvision.js';
import { createStreamProxy } from './services/streamProxy.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createCamerasRouter } from './routes/cameras.routes.js';
import { createEventsRouter } from './routes/events.routes.js';

/**
 * Create the configured Express application and HTTP/WS server.
 */
export function createAppServer({ config, hikvisionClient, streamProxy } = {}) {
  const resolvedConfig = config || loadConfig();
  const resolvedHikvision = hikvisionClient || createHikvisionClient(resolvedConfig);
  const resolvedProxy = streamProxy || createStreamProxy(resolvedConfig);
  const requireAuth = createAuthMiddleware(resolvedConfig);

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:', 'mediastream:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
        },
      },
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(resolvedConfig));
  app.use('/api', requireAuth, createCamerasRouter(resolvedConfig, resolvedHikvision));
  app.use('/api/events', requireAuth, createEventsRouter(resolvedHikvision));

  // Authenticated proxy for go2rtc assets (video-stream.js) and HTTP API
  app.use('/stream', requireAuth, resolvedProxy.httpHandler);

  // Serve built React + Vite frontend when available
  if (fs.existsSync(resolvedConfig.frontendDistPath)) {
    app.use(express.static(resolvedConfig.frontendDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/stream/')) {
        return next();
      }
      return res.sendFile(path.join(resolvedConfig.frontendDistPath, 'index.html'));
    });
  }

  // Fallback error handler
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    const status = err.statusCode || 500;
    return res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const handled = resolvedProxy.handleUpgrade(req, socket, head);
    if (!handled) {
      socket.destroy();
    }
  });

  return { app, server, config: resolvedConfig };
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  loadEnvFiles();
  const config = loadConfig();
  const { server } = createAppServer({ config });
  server.listen(config.port, () => {
    console.log(`Hikvision web backend listening on http://localhost:${config.port}`);
  });
}
