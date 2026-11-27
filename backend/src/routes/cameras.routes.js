import { Router } from 'express';
import {
  UpstreamError,
  ValidationError,
  validateNumericParam,
} from '../services/hikvision.js';

export function createCamerasRouter(config, hikvisionClient) {
  const router = Router();

  router.get('/cameras', (req, res) => {
    res.json({ cameras: config.cameras });
  });

  router.get('/snapshot/:channel', async (req, res, next) => {
    try {
      const channel = validateNumericParam(req.params.channel, 'channel');
      const { contentType, buffer } = await hikvisionClient.getSnapshot(channel);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `inline; filename="snapshot-ch${channel}.jpg"`);
      return res.send(buffer);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/ptz/:channel', async (req, res, next) => {
    try {
      const channel = validateNumericParam(req.params.channel, 'channel');
      const { pan, tilt, zoom } = req.body || {};
      const result = await hikvisionClient.continuousPtz(channel, { pan, tilt, zoom });
      return res.json({ ok: result.ok });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/ptz/:channel/preset/:presetId', async (req, res, next) => {
    try {
      const channel = validateNumericParam(req.params.channel, 'channel');
      const presetId = validateNumericParam(req.params.presetId, 'presetId');
      const result = await hikvisionClient.gotoPreset(channel, presetId);
      return res.json({ ok: result.ok });
    } catch (err) {
      return next(err);
    }
  });

  router.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof UpstreamError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  });

  return router;
}
