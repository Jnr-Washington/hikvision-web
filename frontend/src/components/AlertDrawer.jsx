import React, { useEffect, useState } from 'react';

const MAX_ALERTS = 50;

export default function AlertDrawer({ open, onClose }) {
  const [status, setStatus] = useState({ state: 'connecting', message: 'Connecting...' });
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const source = new EventSource('/api/events/stream', { withCredentials: true });

    source.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        setStatus(data);
      } catch {
        // Ignore malformed status event
      }
    });

    source.addEventListener('alert', (event) => {
      try {
        const alert = JSON.parse(event.data);
        setAlerts((prev) => [
          { ...alert, uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
          ...prev,
        ].slice(0, MAX_ALERTS));
      } catch {
        // Ignore malformed alert event
      }
    });

    source.onerror = () => {
      setStatus({ state: 'reconnecting', message: 'Reconnecting to alert stream...' });
    };

    return () => {
      source.close();
    };
  }, []);

  return (
    <aside className={`alert-drawer ${open ? 'is-open' : ''}`} aria-label="Live camera alerts">
      <div className="drawer-header">
        <div>
          <h3>Live Alerts</h3>
          <span className={`status-pill status-${status.state || 'connecting'}`}>
            {status.state || 'connecting'}
          </span>
        </div>

        <div className="drawer-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setAlerts([])}
            disabled={alerts.length === 0}
          >
            Clear
          </button>
          <button type="button" className="btn btn-ghost mobile-only" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <p className="drawer-subtitle">{status.message}</p>

      <div className="alert-list">
        {alerts.length === 0 ? (
          <div className="alert-empty">No motion or intrusion events received yet.</div>
        ) : (
          alerts.map((item) => (
            <div className="alert-item" key={item.uid}>
              <div className="alert-item-top">
                <span className="alert-type">{item.eventType}</span>
                <span className="alert-channel">Ch {item.channelId}</span>
              </div>
              <div className="alert-desc">{item.description}</div>
              <time className="alert-time">{item.timestamp}</time>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
