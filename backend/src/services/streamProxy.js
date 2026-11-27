import { createProxyMiddleware } from 'http-proxy-middleware';
import { verifyUpgradeAuth } from '../middleware/auth.js';

/**
 * Create an authenticated HTTP and WebSocket proxy to go2rtc.
 * Never exposes go2rtc directly; verifies JWT cookies on both HTTP and WS upgrades.
 */
export function createStreamProxy(config) {
  const proxyMiddleware = createProxyMiddleware({
    target: config.go2rtcInternalUrl,
    changeOrigin: true,
    ws: false,
    pathRewrite: { '^/stream': '' },
    on: {
      error(err, req, res) {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stream relay unavailable' }));
        }
      },
    },
  });

  function httpHandler(req, res, next) {
    // Restore original path (/stream/...) because app.use('/stream', ...) strips the mount prefix
    req.url = req.originalUrl;
    return proxyMiddleware(req, res, next);
  }

  function handleUpgrade(req, socket, head) {
    if (!req.url || !req.url.startsWith('/stream')) {
      return false;
    }

    const user = verifyUpgradeAuth(req, config);
    if (!user) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'Content-Type: text/plain\r\n' +
        'Connection: close\r\n' +
        '\r\n' +
        'Authentication required',
      );
      socket.destroy();
      return true;
    }

    proxyMiddleware.upgrade(req, socket, head);
    return true;
  }

  return {
    httpHandler,
    handleUpgrade,
  };
}
