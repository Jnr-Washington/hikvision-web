import DigestClient from 'digest-fetch';

const CHANNEL_PARAM_REGEX = /^\d{1,4}$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class UpstreamError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'UpstreamError';
    this.statusCode = statusCode;
  }
}

/**
 * Validate numeric route parameters such as :channel or :presetId.
 * Prevents path traversal and SSRF.
 */
export function validateNumericParam(value, label = 'channel') {
  const str = String(value ?? '');
  if (!CHANNEL_PARAM_REGEX.test(str)) {
    throw new ValidationError(`Invalid ${label}: must be 1 to 4 digits`);
  }
  return str;
}

/**
 * Clamp a PTZ axis value to an integer between -100 and 100.
 */
export function clampPtzValue(value, label = 'axis') {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Invalid PTZ ${label} value`);
  }
  const truncated = Math.trunc(num);
  return Math.max(-100, Math.min(100, truncated));
}

/**
 * Build Hikvision ISAPI Continuous PTZ XML payload with clamped values.
 */
export function buildContinuousPtzXml({ pan = 0, tilt = 0, zoom = 0 } = {}) {
  const safePan = clampPtzValue(pan, 'pan');
  const safeTilt = clampPtzValue(tilt, 'tilt');
  const safeZoom = clampPtzValue(zoom, 'zoom');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PTZData>',
    `  <pan>${safePan}</pan>`,
    `  <tilt>${safeTilt}</tilt>`,
    `  <zoom>${safeZoom}</zoom>`,
    '</PTZData>',
  ].join('\n');
}

function extractXmlTag(xml, tagName) {
  const regex = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tagName}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

/**
 * Parse a single EventNotificationAlert XML payload from Hikvision alertStream.
 */
export function parseAlertXmlBlock(xmlText) {
  if (!xmlText || !xmlText.includes('EventNotificationAlert')) {
    return null;
  }

  return {
    channelId: extractXmlTag(xmlText, 'channelID') || extractXmlTag(xmlText, 'dynChannelID') || '1',
    eventType: extractXmlTag(xmlText, 'eventType') || 'unknown',
    eventState: extractXmlTag(xmlText, 'eventState') || 'active',
    description: extractXmlTag(xmlText, 'eventDescription') || 'Camera event',
    timestamp: extractXmlTag(xmlText, 'dateTime') || new Date().toISOString(),
  };
}

/**
 * Create a Hikvision ISAPI client using HTTP Digest authentication.
 * @param {object} config
 * @param {{ fetchImpl?: Function }} [options]
 */
export function createHikvisionClient(config, options = {}) {
  const baseUrl = `http://${config.nvr.ip}:${config.nvr.port}`;
  const isConfigured = Boolean(
    config.nvr.ip &&
    config.nvr.user &&
    config.nvr.pass &&
    config.nvr.pass !== 'REPLACE_ME',
  );

  let digestClient = null;
  function getFetcher() {
    if (options.fetchImpl) {
      return options.fetchImpl;
    }
    if (!digestClient) {
      digestClient = new DigestClient(config.nvr.user, config.nvr.pass, { algorithm: 'MD5' });
    }
    return (url, init) => digestClient.fetch(url, init);
  }

  async function getSnapshot(channel) {
    const safeChannel = validateNumericParam(channel, 'channel');
    const fetcher = getFetcher();
    const response = await fetcher(`${baseUrl}/ISAPI/Streaming/channels/${safeChannel}/picture`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new UpstreamError(`NVR snapshot request failed with status ${response.status}`, 502);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      contentType: response.headers?.get?.('content-type') || 'image/jpeg',
      buffer: Buffer.from(arrayBuffer),
    };
  }

  async function continuousPtz(channel, ptzInput) {
    const safeChannel = validateNumericParam(channel, 'channel');
    const xmlBody = buildContinuousPtzXml(ptzInput);
    const fetcher = getFetcher();
    const response = await fetcher(`${baseUrl}/ISAPI/PTZCtrl/channels/${safeChannel}/continuous`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlBody,
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new UpstreamError(`NVR PTZ request failed with status ${response.status}`, 502);
    }

    return { ok: true, xml: xmlBody };
  }

  async function gotoPreset(channel, presetId) {
    const safeChannel = validateNumericParam(channel, 'channel');
    const safePreset = validateNumericParam(presetId, 'presetId');
    const fetcher = getFetcher();
    const response = await fetcher(
      `${baseUrl}/ISAPI/PTZCtrl/channels/${safeChannel}/presets/${safePreset}/goto`,
      {
        method: 'PUT',
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      throw new UpstreamError(`NVR preset request failed with status ${response.status}`, 502);
    }

    return { ok: true };
  }

  /**
   * Stream multipart XML alert events from Hikvision ISAPI alertStream with reconnect backoff.
   */
  function subscribeAlerts(onEvent, onStatus, abortSignal) {
    if (!isConfigured && !options.fetchImpl) {
      onStatus?.({ state: 'unconfigured', message: 'NVR credentials not configured yet' });
      return;
    }

    const fetcher = getFetcher();
    let backoffMs = 1000;

    (async () => {
      while (!abortSignal.aborted) {
        try {
          onStatus?.({ state: 'connecting', message: 'Connecting to NVR alert stream' });
          const response = await fetcher(`${baseUrl}/ISAPI/Event/notification/alertStream`, {
            method: 'GET',
            signal: abortSignal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`Alert stream returned HTTP ${response.status}`);
          }

          backoffMs = 1000;
          onStatus?.({ state: 'connected', message: 'Connected to NVR alert stream' });

          let buffer = '';
          for await (const chunk of response.body) {
            if (abortSignal.aborted) break;
            buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

            // Extract complete <EventNotificationAlert>...</EventNotificationAlert> blocks
            let endIdx;
            while ((endIdx = buffer.indexOf('</EventNotificationAlert>')) !== -1) {
              const startIdx = buffer.lastIndexOf('<EventNotificationAlert', endIdx);
              const blockEnd = endIdx + '</EventNotificationAlert>'.length;
              if (startIdx !== -1) {
                const xmlBlock = buffer.slice(startIdx, blockEnd);
                const parsed = parseAlertXmlBlock(xmlBlock);
                if (parsed) {
                  onEvent(parsed);
                }
              }
              buffer = buffer.slice(blockEnd);
            }

            if (buffer.length > 131072) {
              buffer = buffer.slice(-32768);
            }
          }
        } catch (err) {
          if (abortSignal.aborted) break;
          onStatus?.({ state: 'reconnecting', message: err.message });
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, backoffMs);
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      }
    })();
  }

  return {
    getSnapshot,
    continuousPtz,
    gotoPreset,
    subscribeAlerts,
  };
}
