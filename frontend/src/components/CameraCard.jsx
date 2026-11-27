import React, { useEffect, useRef, useState } from 'react';
import { downloadSnapshot, sendPtzCommand } from '../api.js';

const PTZ_SPEED = 45;

export default function CameraCard({ camera, streamStatus, onNotify }) {
  const [quality, setQuality] = useState('sd');
  const [muted, setMuted] = useState(true);
  const [snapLoading, setSnapLoading] = useState(false);
  const [ptzActive, setPtzActive] = useState(false);

  const stageRef = useRef(null);
  const videoStreamRef = useRef(null);
  const ptzMovingRef = useRef(false);

  const streamKey = quality === 'hd' ? camera.hdStream : camera.sdStream;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const streamWsUrl = `${wsProtocol}//${window.location.host}/stream/api/ws?src=${encodeURIComponent(streamKey)}`;

  useEffect(() => {
    const el = videoStreamRef.current;
    if (!el || streamStatus !== 'ready') return;

    el.mode = 'mse,webrtc';
    el.src = streamWsUrl;
  }, [streamWsUrl, streamStatus]);

  useEffect(() => {
    const el = videoStreamRef.current;
    if (!el) return;

    const applyMute = () => {
      const videoEl = el.querySelector('video') || el.shadowRoot?.querySelector('video');
      if (videoEl) {
        videoEl.muted = muted;
      }
    };

    applyMute();
    const timer = setTimeout(applyMute, 400);
    return () => clearTimeout(timer);
  }, [muted, streamWsUrl, streamStatus]);

  async function handleSnapshot() {
    setSnapLoading(true);
    try {
      await downloadSnapshot(camera.snapshotChannel, camera.id);
      onNotify?.(`Saved snapshot for ${camera.name}`);
    } catch (err) {
      onNotify?.(err.message || 'Failed to capture snapshot', true);
    } finally {
      setSnapLoading(false);
    }
  }

  function handleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;

    if (document.fullscreenElement === stage) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      stage.requestFullscreen?.().catch(() => {});
    }
  }

  async function startPtz(vector) {
    if (!camera.hasPtz || !camera.ptzChannel) return;
    ptzMovingRef.current = true;
    setPtzActive(true);
    try {
      await sendPtzCommand(camera.ptzChannel, vector);
    } catch (err) {
      onNotify?.(err.message || 'PTZ move failed', true);
    }
  }

  async function stopPtz() {
    if (!ptzMovingRef.current || !camera.ptzChannel) return;
    ptzMovingRef.current = false;
    setPtzActive(false);
    try {
      await sendPtzCommand(camera.ptzChannel, { pan: 0, tilt: 0, zoom: 0 });
    } catch {
      // Ignore stop errors if session ended
    }
  }

  function bindPtzButton(vector) {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        startPtz(vector);
      },
      onPointerUp: stopPtz,
      onPointerLeave: stopPtz,
      onPointerCancel: stopPtz,
    };
  }

  return (
    <article className="camera-card">
      <header className="camera-header">
        <div className="camera-title-group">
          <span className={`live-dot ${streamStatus === 'ready' ? 'is-ready' : 'is-offline'}`} />
          <h2>{camera.name}</h2>
          <span className="camera-id">{camera.id}</span>
        </div>

        <div className="quality-switch" role="group" aria-label={`${camera.name} stream quality`}>
          <button
            type="button"
            className={`seg-btn ${quality === 'sd' ? 'is-active' : ''}`}
            onClick={() => setQuality('sd')}
          >
            SD
          </button>
          <button
            type="button"
            className={`seg-btn ${quality === 'hd' ? 'is-active' : ''}`}
            onClick={() => setQuality('hd')}
          >
            HD
          </button>
        </div>
      </header>

      <div className="video-stage" ref={stageRef}>
        {streamStatus === 'ready' ? (
          <video-stream
            ref={videoStreamRef}
            mode="mse,webrtc"
            className="video-element"
          />
        ) : (
          <div className="video-placeholder">
            <span className="placeholder-title">
              {streamStatus === 'loading'
                ? 'Connecting to stream relay...'
                : 'Stream relay offline (go2rtc unavailable)'}
            </span>
            <span className="placeholder-sub">Stream key: {streamKey}</span>
          </div>
        )}

        <div className="stage-badge">{quality.toUpperCase()}</div>
      </div>

      <div className="camera-controls">
        <div className="action-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSnapshot}
            disabled={snapLoading}
          >
            {snapLoading ? 'Saving...' : 'Snapshot'}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMuted((prev) => !prev)}
            aria-pressed={!muted}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>

          <button type="button" className="btn btn-secondary" onClick={handleFullscreen}>
            Fullscreen
          </button>
        </div>

        {camera.hasPtz && (
          <div className="ptz-panel" aria-label={`${camera.name} PTZ controls`}>
            <div className="ptz-dpad">
              <span />
              <button type="button" className="ptz-btn" title="Tilt Up" {...bindPtzButton({ tilt: PTZ_SPEED })}>
                ▲
              </button>
              <span />
              <button type="button" className="ptz-btn" title="Pan Left" {...bindPtzButton({ pan: -PTZ_SPEED })}>
                ◀
              </button>
              <span className={`ptz-center ${ptzActive ? 'is-active' : ''}`} title="PTZ Status">
                PTZ
              </span>
              <button type="button" className="ptz-btn" title="Pan Right" {...bindPtzButton({ pan: PTZ_SPEED })}>
                ▶
              </button>
              <span />
              <button type="button" className="ptz-btn" title="Tilt Down" {...bindPtzButton({ tilt: -PTZ_SPEED })}>
                ▼
              </button>
              <span />
            </div>

            <div className="ptz-zoom">
              <button type="button" className="ptz-btn" title="Zoom In" {...bindPtzButton({ zoom: PTZ_SPEED })}>
                Z+
              </button>
              <button type="button" className="ptz-btn" title="Zoom Out" {...bindPtzButton({ zoom: -PTZ_SPEED })}>
                Z−
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
