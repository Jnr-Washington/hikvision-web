import { Router } from 'express';

export function createEventsRouter(hikvisionClient) {
  const router = Router();

  router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();

    const sendSse = (eventName, payload) => {
      if (res.writableEnded || abortController.signal.aborted) return;
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendSse('status', { state: 'connecting', message: 'Subscribing to camera alerts' });

    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 25_000);

    hikvisionClient.subscribeAlerts(
      (alert) => sendSse('alert', alert),
      (status) => sendSse('status', status),
      abortController.signal,
    );

    req.on('close', () => {
      clearInterval(keepaliveTimer);
      abortController.abort();
    });
  });

  return router;
}
