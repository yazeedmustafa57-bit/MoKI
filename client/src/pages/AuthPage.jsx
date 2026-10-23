import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api.js';

export default function AuthPage({ onAuthenticated }) {
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { email: form.email, password: form.password, remember: form.remember },
        skipUnauthorized: true,
      });
      onAuthenticated(data.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <aside className="auth-brand">
        <div className="brand-lockup">
          <span className="brand-mark">V</span>
          <span>
            <strong>Victor</strong>
            <small>AI Assistant</small>
          </span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Dein Assistent. Ein Ort.</span>
          <h1>Weniger Verwaltung.<br />Mehr Überblick.</h1>
          <p>
            Anrufe, Transkripte, Aufgaben und Termine laufen bei Victor zusammen – ruhig,
            übersichtlich und auf jedem Gerät.
          </p>
          <ul className="auth-features">
            <li>
              <Sparkles size={17} aria-hidden="true" /> Sprachassistent mit ElevenLabs
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" /> Zugangsdaten bleiben auf dem Server
            </li>
            <li>
              <LockKeyhole size={17} aria-hidden="true" /> Geschützter persönlicher Bereich
            </li>
          </ul>
        </div>
        <span className="auth-footnote">Victor AI Assistant · lokal betrieben</span>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark">V</span>
            <strong>Victor AI</strong>
          </div>
          <div className="auth-heading">
            <h2>Willkommen zurück</h2>
            <p>Melde dich an, um mit Victor weiterzuarbeiten.</p>
          </div>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} className="auth-form">
            <label className="field">
              <span>E-Mail-Adresse</span>
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={update('email')}
                placeholder="du@beispiel.de"
                data-autofocus
                required
              />
            </label>

            <label className="field">
              <span>Passwort</span>
              <div className="input-with-action">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={update('password')}
                  placeholder="Dein Passwort"
                  required
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                name="remember"
                checked={form.remember}
                onChange={update('remember')}
              />
              <span>Angemeldet bleiben</span>
            </label>

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? <LoaderCircle size={18} className="spin" /> : null}
              Anmelden
            </button>
          </form>

          <p className="auth-note">
            Die öffentliche Registrierung ist deaktiviert. Zugriff hat ausschließlich das
            konfigurierte Owner-Konto.
          </p>
        </div>
      </main>
    </div>
  );
}
