import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import {
  Avatar,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  SectionCard,
} from '../components/ui.jsx';
import { formatDate } from '../utils/format.js';

const TIMEZONES = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
];

const COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#b91c1c', '#c2410c', '#334155'];

export default function Profile() {
  const profileApi = useApi('/account/profile');
  const { user, updateUser } = useApp();
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);

  useEffect(() => {
    if (profileApi.data?.user) {
      const data = profileApi.data.user;
      setForm({
        name: data.name,
        email: data.email,
        company: data.company,
        phone: data.phone,
        timezone: data.timezone,
        avatarColor: data.avatarColor,
      });
    }
  }, [profileApi.data]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const data = await api('/account/profile', { method: 'PATCH', body: form });
      updateUser(data.user);
      toast('Profil gespeichert.');
    } catch (requestError) {
      setSaveError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError(null);
    if (passwords.newPassword.length < 10) {
      setPasswordError('Das neue Passwort muss mindestens 10 Zeichen lang sein.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    setChangingPassword(true);
    try {
      const data = await api('/account/profile/password', {
        method: 'POST',
        body: {
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        },
      });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast(data.message || 'Passwort geändert.');
    } catch (requestError) {
      setPasswordError(requestError.message);
    } finally {
      setChangingPassword(false);
    }
  };

  if (profileApi.loading && !profileApi.data) return <LoadingState label="Profil wird geladen …" />;
  if (profileApi.error && !profileApi.data) {
    return <ErrorState error={profileApi.error} onRetry={profileApi.reload} />;
  }
  if (!form) return null;

  const timezoneOptions = TIMEZONES.includes(form.timezone)
    ? TIMEZONES
    : [form.timezone, ...TIMEZONES];

  return (
    <div className="page-stack">
      <PageHeader
        title="Profil"
        description="Persönliche Angaben und Zugang zu deinem geschützten Bereich."
      />

      <div className="profile-layout">
        <aside className="card profile-summary">
          <Avatar name={form.name} color={form.avatarColor} size="lg" />
          <h2>{form.name}</h2>
          <p>{form.email}</p>
          <div className="profile-meta">
            <span>
              <ShieldCheck size={15} /> {user.role === 'owner' ? 'Inhaber' : user.role}
            </span>
            <span>
              <BadgeCheck size={15} /> Mitglied seit {formatDate(user.createdAt)}
            </span>
          </div>
          <div className="profile-divider" />
          <div className="profile-colors" role="group" aria-label="Avatarfarbe wählen">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${form.avatarColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setForm((current) => ({ ...current, avatarColor: color }))}
                aria-label={`Farbe ${color}`}
                aria-pressed={form.avatarColor === color}
              />
            ))}
          </div>
          <p className="muted small">
            Die Farbe wird für deinen Avatar in der Navigation verwendet.
          </p>
        </aside>

        <div className="profile-forms">
          <SectionCard title="Persönliche Angaben" description="Wird nur in dieser Anwendung gespeichert.">
            <form className="form-grid" onSubmit={saveProfile}>
              {saveError ? <div className="form-error form-grid-full">{saveError}</div> : null}
              <Field label="Name" htmlFor="profile-name">
                <input
                  id="profile-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </Field>
              <Field label="E-Mail" htmlFor="profile-email">
                <input
                  id="profile-email"
                  type="email"
                  inputMode="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Unternehmen" htmlFor="profile-company">
                <input
                  id="profile-company"
                  value={form.company}
                  onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Telefon" htmlFor="profile-phone">
                <input
                  id="profile-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+49 …"
                />
              </Field>
              <Field label="Zeitzone" htmlFor="profile-timezone" className="form-grid-full">
                <select
                  id="profile-timezone"
                  value={form.timezone}
                  onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}
                >
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-grid-full form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                  Profil speichern
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            title="Passwort ändern"
            description="Andere aktive Sitzungen werden nach der Änderung abgemeldet."
          >
            <form className="form-grid" onSubmit={changePassword}>
              {passwordError ? <div className="form-error form-grid-full">{passwordError}</div> : null}
              <Field label="Aktuelles Passwort" htmlFor="password-current" className="form-grid-full">
                <input
                  id="password-current"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.currentPassword}
                  onChange={(event) =>
                    setPasswords((current) => ({ ...current, currentPassword: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Neues Passwort" htmlFor="password-new">
                <input
                  id="password-new"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(event) =>
                    setPasswords((current) => ({ ...current, newPassword: event.target.value }))
                  }
                  placeholder="Mindestens 10 Zeichen"
                  required
                />
              </Field>
              <Field label="Neues Passwort wiederholen" htmlFor="password-confirm">
                <input
                  id="password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.confirmPassword}
                  onChange={(event) =>
                    setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))
                  }
                  required
                />
              </Field>
              <div className="form-grid-full form-actions">
                <button type="submit" className="btn btn-secondary" disabled={changingPassword}>
                  {changingPassword ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <KeyRound size={16} />
                  )}
                  Passwort ändern
                </button>
              </div>
            </form>
          </SectionCard>

          <div className="notice notice-neutral">
            <UserRound size={18} aria-hidden="true" />
            <p>
              Profil- und Passwortdaten liegen in der lokalen SQLite-Datenbank. Es werden keine
              Profildaten an ElevenLabs oder Zadarma übertragen.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
