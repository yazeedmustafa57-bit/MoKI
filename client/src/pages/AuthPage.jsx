import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api.js';

export default function AuthPage({ setupRequired, onAuthenticated }) {
  const [mode, setMode] = useState(setupRequired ? 'setup' : 'login');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    remember: true,
  });
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
    if (mode === 'setup') {
      if (form.name.trim().length < 2) {
        setError('Bitte gib deinen Namen ein.');
        return;
      }
      if (form.password.length < 10) {
        setError('Das Passwort muss mindestens 10 Zeichen lang sein.');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('Die Passwörter stimmen nicht überein.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const path = mode === 'setup' ? '/auth/setup' : '/auth/login';
      const body =
        mode === 'setup'
          ? { name: form.name, email: form.email, password: form.password }
          : { email: form.email, password: form.password, remember: form.remember };
      const data = await api(path, { method: 'POST', body, skipUnauthorized: true });
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
            <h2>{mode === 'setup' ? 'Konto einrichten' : 'Willkommen zurück'}</h2>
            <p>
              {mode === 'setup'
                ? 'Lege das erste Konto für deinen geschützten Victor-Bereich an.'
                : 'Melde dich an, um mit Victor weiterzuarbeiten.'}
            </p>
          </div>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} className="auth-form">
            {mode === 'setup' ? (
              <label className="field">
                <span>Name</span>
                <input
                  name="name"
                  autoComplete="name"
                  value={form.name}
                  onChange={update('name')}
                  placeholder="Vor- und Nachname"
                  data-autofocus
                  required
                />
              </label>
            ) : null}

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
                data-autofocus={mode === 'login' ? true : undefined}
                required
              />
            </label>

            <label className="field">
              <span>Passwort</span>
              <div className="input-with-action">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={update('password')}
                  placeholder={mode === 'setup' ? 'Mindestens 10 Zeichen' : 'Dein Passwort'}
                  minLength={mode === 'setup' ? 10 : undefined}
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

            {mode === 'setup' ? (
              <label className="field">
                <span>Passwort wiederholen</span>
                <input
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={update('confirmPassword')}
                  placeholder="Passwort erneut eingeben"
                  required
                />
              </label>
            ) : (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="remember"
                  checked={form.remember}
                  onChange={update('remember')}
                />
                <span>Angemeldet bleiben</span>
              </label>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? <LoaderCircle size={18} className="spin" /> : null}
              {mode === 'setup' ? 'Konto erstellen' : 'Anmelden'}
            </button>
          </form>

          {!setupRequired ? (
            <p className="auth-switch">
              {mode === 'login' ? (
                <>
                  Noch kein Konto?{' '}
                  <button type="button" onClick={() => setMode('setup')}>
                    Einrichtung starten
                  </button>
                </>
              ) : (
                <>
                  Konto bereits vorhanden?{' '}
                  <button type="button" onClick={() => setMode('login')}>
                    Zur Anmeldung
                  </button>
                </>
              )}
            </p>
          ) : (
            <p className="auth-note">
              Dies ist die einmalige Ersteinrichtung. Das Konto wird lokal in der Datenbank
              angelegt. Es werden keine Daten an Dritte übertragen.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
