import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_PATH = path.resolve(__dirname, '../../.env');
const BACKEND_ENV_PATH = path.resolve(__dirname, '../.env');

/**
 * Load environment variables from backend/.env or root .env if present.
 */
export function loadEnvFiles() {
  if (fs.existsSync(BACKEND_ENV_PATH)) {
    dotenv.config({ path: BACKEND_ENV_PATH });
  }
  if (fs.existsSync(ROOT_ENV_PATH)) {
    dotenv.config({ path: ROOT_ENV_PATH });
  }
}

const CHANNEL_ID_REGEX = /^\d{1,4}$/;
const STREAM_KEY_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Parse and sanitize CAMERAS_JSON into safe metadata objects.
 * Never exposes RTSP URLs or NVR credentials.
 * @param {string} rawJson
 * @returns {Array<{id: string, name: string, hdStream: string, sdStream: string, snapshotChannel: string, ptzChannel: string|null, hasPtz: boolean}>}
 */
export function parseCamerasJson(rawJson) {
  if (!rawJson || !rawJson.trim()) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Invalid CAMERAS_JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('CAMERAS_JSON must be a JSON array');
  }

  return parsed.map((cam, index) => {
    if (!cam || typeof cam !== 'object') {
      throw new Error(`CAMERAS_JSON[${index}] must be an object`);
    }
    const id = String(cam.id || '').trim();
    const name = String(cam.name || id).trim();
    const hdStream = String(cam.hdStream || '').trim();
    const sdStream = String(cam.sdStream || hdStream).trim();
    const snapshotChannel = String(cam.snapshotChannel || '').trim();
    const hasPtz = Boolean(cam.hasPtz);
    const ptzChannel = cam.ptzChannel != null ? String(cam.ptzChannel).trim() : null;

    if (!STREAM_KEY_REGEX.test(id)) {
      throw new Error(`CAMERAS_JSON[${index}].id is invalid`);
    }
    if (!STREAM_KEY_REGEX.test(hdStream) || !STREAM_KEY_REGEX.test(sdStream)) {
      throw new Error(`CAMERAS_JSON[${index}] stream key is invalid`);
    }
    if (!CHANNEL_ID_REGEX.test(snapshotChannel)) {
      throw new Error(`CAMERAS_JSON[${index}].snapshotChannel must be 1-4 digits`);
    }
    if (hasPtz && (!ptzChannel || !CHANNEL_ID_REGEX.test(ptzChannel))) {
      throw new Error(`CAMERAS_JSON[${index}].ptzChannel must be 1-4 digits when hasPtz is true`);
    }

    return {
      id,
      name,
      hdStream,
      sdStream,
      snapshotChannel,
      ptzChannel: hasPtz ? ptzChannel : null,
      hasPtz,
    };
  });
}

/**
 * Build validated runtime configuration from an env object.
 * @param {Record<string, string|undefined>} env
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const port = Number.parseInt(env.PORT || '3001', 10);
  const minPort = nodeEnv === 'test' ? 0 : 1;
  if (!Number.isInteger(port) || port < minPort || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const jwtSecret = (env.JWT_SECRET || '').trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  const adminUser = (env.APP_ADMIN_USER || 'admin').trim();
  const adminPassHash = (env.APP_ADMIN_PASS_HASH || '').trim();
  if (!adminPassHash) {
    throw new Error('APP_ADMIN_PASS_HASH environment variable is required');
  }

  const nvrPort = Number.parseInt(env.NVR_PORT || '80', 10);
  if (!Number.isInteger(nvrPort) || nvrPort < 1 || nvrPort > 65535) {
    throw new Error(`Invalid NVR_PORT: ${env.NVR_PORT}`);
  }

  const cameras = parseCamerasJson(env.CAMERAS_JSON || '[]');

  return {
    nodeEnv,
    isProd,
    port,
    publicOrigin: (env.PUBLIC_ORIGIN || `http://localhost:${port}`).trim(),
    auth: {
      adminUser,
      adminPassHash,
      jwtSecret,
      cookieName: 'cctv_session',
      tokenTtl: '12h',
    },
    nvr: {
      ip: (env.NVR_IP || '').trim(),
      port: nvrPort,
      user: (env.NVR_USER || '').trim(),
      pass: env.NVR_PASS || '',
    },
    cameras,
    go2rtcInternalUrl: (env.GO2RTC_INTERNAL_URL || 'http://go2rtc:1984').trim().replace(/\/+$/, ''),
    frontendDistPath: path.resolve(__dirname, '../../frontend/dist'),
  };
}
