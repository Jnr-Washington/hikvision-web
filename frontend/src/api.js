async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to verify session');
  const data = await parseJsonResponse(res);
  return data?.user || null;
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(data?.error || 'Login failed');
  }
  return data.user;
}

export async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
}

export async function fetchCameras() {
  const res = await fetch('/api/cameras', { credentials: 'include' });
  if (res.status === 401) {
    const err = new Error('Session expired');
    err.status = 401;
    throw err;
  }
  const data = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to load cameras');
  }
  return data?.cameras || [];
}

export async function downloadSnapshot(channel, cameraId) {
  const res = await fetch(`/api/snapshot/${encodeURIComponent(channel)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await parseJsonResponse(res);
    throw new Error(data?.error || `Snapshot failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${cameraId}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sendPtzCommand(channel, { pan = 0, tilt = 0, zoom = 0 }) {
  const res = await fetch(`/api/ptz/${encodeURIComponent(channel)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pan, tilt, zoom }),
  });
  if (!res.ok) {
    const data = await parseJsonResponse(res);
    throw new Error(data?.error || 'PTZ command failed');
  }
}

let videoStreamPromise = null;

/**
 * Dynamically load go2rtc's <video-stream> web component after login
 * so unauthenticated page loads never trigger a 401 on /stream/video-stream.js.
 */
export function ensureVideoStreamComponent() {
  if (typeof customElements !== 'undefined' && customElements.get('video-stream')) {
    return Promise.resolve('ready');
  }
  if (videoStreamPromise) {
    return videoStreamPromise;
  }

  videoStreamPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/stream/video-stream.js';
    script.onload = () => resolve('ready');
    script.onerror = () => {
      videoStreamPromise = null;
      resolve('unavailable');
    };
    document.head.appendChild(script);
  });

  return videoStreamPromise;
}
