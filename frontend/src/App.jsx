import React, { useCallback, useEffect, useState } from 'react';
import {
  ensureVideoStreamComponent,
  fetchCameras,
  fetchCurrentUser,
  logout,
} from './api.js';
import LoginOverlay from './components/LoginOverlay.jsx';
import CameraCard from './components/CameraCard.jsx';
import AlertDrawer from './components/AlertDrawer.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [streamStatus, setStreamStatus] = useState('loading');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadDashboard = useCallback(async () => {
    try {
      const [cameraList, scriptState] = await Promise.all([
        fetchCameras(),
        ensureVideoStreamComponent(),
      ]);
      setCameras(cameraList);
      setStreamStatus(scriptState);
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
      } else {
        showToast(err.message || 'Failed to load dashboard', true);
      }
    }
  }, [showToast]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const currentUser = await fetchCurrentUser();
        if (!active) return;
        setUser(currentUser);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setAuthChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user) {
      loadDashboard();
    }
  }, [user, loadDashboard]);

  async function handleLogout() {
    await logout();
    setUser(null);
    setCameras([]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand-badge">CCTV</span>
          <div>
            <h1>Home Surveillance</h1>
            <span className="topbar-sub">
              {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'} configured
            </span>
          </div>
        </div>

        {user && (
          <div className="topbar-actions">
            <span className="user-pill">{user.username}</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              {drawerOpen ? 'Hide Alerts' : 'Show Alerts'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        )}
      </header>

      {toast && (
        <div className={`toast ${toast.isError ? 'is-error' : ''}`} role="status">
          {toast.message}
        </div>
      )}

      {!authChecked ? (
        <main className="loading-screen">Checking session...</main>
      ) : !user ? (
        <LoginOverlay onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />
      ) : (
        <div className="workspace-layout">
          <main className="camera-grid-area">
            {cameras.length === 0 ? (
              <div className="empty-state">
                No cameras configured in <code>CAMERAS_JSON</code>.
              </div>
            ) : (
              <div className="camera-grid">
                {cameras.map((cam) => (
                  <CameraCard
                    key={cam.id}
                    camera={cam}
                    streamStatus={streamStatus}
                    onNotify={showToast}
                  />
                ))}
              </div>
            )}
          </main>

          <AlertDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        </div>
      )}
    </div>
  );
}
