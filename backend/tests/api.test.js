import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import bcrypt from 'bcryptjs';

import { loadConfig } from '../src/config.js';
import {
  buildContinuousPtzXml,
  clampPtzValue,
  createHikvisionClient,
  parseAlertXmlBlock,
} from '../src/services/hikvision.js';
import { createAppServer } from '../src/server.js';

function listenServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function sendRawUpgradeRequest({ port, path, cookieHeader }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const headers = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
      ];
      if (cookieHeader) {
        headers.push(`Cookie: ${cookieHeader}`);
      }
      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
    });

    let responseData = '';
    socket.on('data', (chunk) => {
      responseData += chunk.toString('utf8');
      if (responseData.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(responseData);
      }
    });
    socket.on('end', () => resolve(responseData));
    socket.on('error', (err) => {
      if (responseData) resolve(responseData);
      else reject(err);
    });
  });
}

test('Hikvision PTZ clamping and XML formatting', () => {
  assert.equal(clampPtzValue(250, 'pan'), 100);
  assert.equal(clampPtzValue(-999, 'tilt'), -100);
  assert.equal(clampPtzValue(42.9, 'zoom'), 42);
  assert.equal(clampPtzValue(undefined, 'zoom'), 0);

  const xml = buildContinuousPtzXml({ pan: 250, tilt: -999, zoom: 120.7 });
  assert.match(xml, /<PTZData>/);
  assert.match(xml, /<pan>100<\/pan>/);
  assert.match(xml, /<tilt>-100<\/tilt>/);
  assert.match(xml, /<zoom>100<\/zoom>/);
});

test('Hikvision alert XML parser extracts alert fields', () => {
  const alert = parseAlertXmlBlock(`
    <EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
      <channelID>2</channelID>
      <dateTime>2026-11-25T10:00:00Z</dateTime>
      <eventType>VMD</eventType>
      <eventState>active</eventState>
      <eventDescription>Motion alarm</eventDescription>
    </EventNotificationAlert>
  `);
  assert.deepEqual(alert, {
    channelId: '2',
    eventType: 'VMD',
    eventState: 'active',
    description: 'Motion alarm',
    timestamp: '2026-11-25T10:00:00Z',
  });
});

test('Backend auth, sanitization, mocked ISAPI, and WS proxy enforcement', async () => {
  const password = 'test-password-123';
  const passHash = await bcrypt.hash(password, 4);

  // Mock go2rtc HTTP + WebSocket server
  const mockGo2rtc = http.createServer((req, res) => {
    if (req.url === '/video-stream.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end('console.log("mock video-stream");');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  mockGo2rtc.on('upgrade', (req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n',
    );
    socket.end();
  });

  let server;
  try {
    const go2rtcUrl = await listenServer(mockGo2rtc);

    const recordedIsapiCalls = [];
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      PUBLIC_ORIGIN: 'http://localhost:3001',
      APP_ADMIN_USER: 'admin',
      APP_ADMIN_PASS_HASH: passHash,
      JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      NVR_IP: '192.0.2.10',
      NVR_PORT: '80',
      NVR_USER: 'viewer',
      NVR_PASS: 'secret',
      CAMERAS_JSON: JSON.stringify([
        {
          id: 'front_door',
          name: 'Front Door',
          hdStream: 'front_door_hd',
          sdStream: 'front_door_sd',
          snapshotChannel: '101',
          ptzChannel: '1',
          hasPtz: true,
        },
      ]),
      GO2RTC_INTERNAL_URL: go2rtcUrl,
    });

    const mockHikvision = createHikvisionClient(config, {
      fetchImpl: async (url, init = {}) => {
        recordedIsapiCalls.push({ url, method: init.method, body: init.body });

        if (url.endsWith('/ISAPI/Streaming/channels/101/picture')) {
          return new Response(fakeJpeg, {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' },
          });
        }
        if (url.includes('/ISAPI/PTZCtrl/channels/')) {
          return new Response('<ResponseStatus><statusCode>1</statusCode></ResponseStatus>', {
            status: 200,
            headers: { 'Content-Type': 'application/xml' },
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    ({ server } = createAppServer({ config, hikvisionClient: mockHikvision }));
    const baseUrl = await listenServer(server);
    const { port } = server.address();
    // 1. Unauthenticated requests return 401
    const unauthCameras = await fetch(`${baseUrl}/api/cameras`);
    assert.equal(unauthCameras.status, 401);

    const unauthSnapshot = await fetch(`${baseUrl}/api/snapshot/101`);
    assert.equal(unauthSnapshot.status, 401);

    const unauthStreamHttp = await fetch(`${baseUrl}/stream/video-stream.js`);
    assert.equal(unauthStreamHttp.status, 401);

    const unauthWsResp = await sendRawUpgradeRequest({
      port,
      path: '/stream/api/ws?src=front_door_hd',
    });
    assert.match(unauthWsResp, /^HTTP\/1\.1 401 Unauthorized/);

    // 2. Valid login sets HttpOnly cookie and unlocks protected endpoints
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    });
    assert.equal(loginRes.status, 200);

    const setCookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(setCookieHeader, 'Expected Set-Cookie header');
    assert.match(setCookieHeader, /cctv_session=/);
    assert.match(setCookieHeader, /HttpOnly/i);
    assert.match(setCookieHeader, /SameSite=Lax/i);

    const cookiePair = setCookieHeader.split(';')[0];

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.username, 'admin');

    const camsRes = await fetch(`${baseUrl}/api/cameras`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(camsRes.status, 200);
    const camsJson = await camsRes.json();
    assert.equal(camsJson.cameras.length, 1);
    assert.equal(camsJson.cameras[0].id, 'front_door');

    // 3. Invalid channel IDs return 400
    for (const badChannel of ['abc', '..%2Fetc', '12345', '101a']) {
      const badSnap = await fetch(`${baseUrl}/api/snapshot/${badChannel}`, {
        headers: { Cookie: cookiePair },
      });
      assert.equal(badSnap.status, 400, `Expected 400 for channel ${badChannel}`);

      const badPtz = await fetch(`${baseUrl}/api/ptz/${badChannel}`, {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pan: 10, tilt: 0, zoom: 0 }),
      });
      assert.equal(badPtz.status, 400, `Expected 400 for PTZ channel ${badChannel}`);
    }

    // 4. Out-of-range PTZ values are clamped to [-100, 100] and generate valid XML
    const ptzRes = await fetch(`${baseUrl}/api/ptz/1`, {
      method: 'POST',
      headers: {
        Cookie: cookiePair,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pan: 500, tilt: -300, zoom: 150 }),
    });
    assert.equal(ptzRes.status, 200);
    const ptzCall = recordedIsapiCalls.find((c) => c.url.includes('/ISAPI/PTZCtrl/channels/1/continuous'));
    assert.ok(ptzCall);
    assert.equal(ptzCall.method, 'PUT');
    assert.match(ptzCall.body, /<pan>100<\/pan>/);
    assert.match(ptzCall.body, /<tilt>-100<\/tilt>/);
    assert.match(ptzCall.body, /<zoom>100<\/zoom>/);

    // 5. Mocked ISAPI snapshot returns 200 with image/jpeg
    const snapRes = await fetch(`${baseUrl}/api/snapshot/101`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(snapRes.status, 200);
    assert.match(snapRes.headers.get('content-type'), /^image\/jpeg/);
    const snapBuf = Buffer.from(await snapRes.arrayBuffer());
    assert.deepEqual(snapBuf, fakeJpeg);

    // 6. Authenticated HTTP + WS /stream proxy succeeds
    const streamJsRes = await fetch(`${baseUrl}/stream/video-stream.js`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(streamJsRes.status, 200);
    assert.match(await streamJsRes.text(), /mock video-stream/);

    const authWsResp = await sendRawUpgradeRequest({
      port,
      path: '/stream/api/ws?src=front_door_hd',
      cookieHeader: cookiePair,
    });
    assert.match(authWsResp, /^HTTP\/1\.1 101 Switching Protocols/);
  } finally {
    if (server) await closeServer(server);
    await closeServer(mockGo2rtc);
  }
});
