import React, { useState } from 'react';
import { login } from '../api.js';

export default function LoginOverlay({ onLoginSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const user = await login(username.trim(), password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="login-card">
        <div className="login-header">
          <div className="brand-badge">CCTV</div>
          <div>
            <h1 id="login-title">Hikvision Remote Monitor</h1>
            <p>Sign in to view live camera feeds and alerts</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
