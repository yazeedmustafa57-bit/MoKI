import { useEffect, useRef, useState } from 'react';
import {
  Database,
  LoaderCircle,
  LogOut,
  Monitor,
  Moon,
  Save,
  Sun,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import { useApp } from '../context/AppContext.jsx';
import {
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  SectionCard,
  Toggle,
} from '../components/ui.jsx';

const THEMES = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon },
];

export default function Settings() {
  const settingsApi = useApi('/account/settings');
  const { applySettings, logout } = useApp();
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const formRef = useRef(null);
  const revisionRef = useRef(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const persistRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (formRef.current) {
          Promise.resolve(
            persistRef.current?.(formRef.current, revisionRef.current),
          ).catch(() => {});
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!settingsApi.data?.settings) return;
    const settings = settingsApi.data.settings;
    formRef.current = settings;
    setForm(settings);
    initializedRef.current = true;
    setSaveState('saved');
    setLastSavedAt(settings.updatedAt || null);
  }, [settingsApi.data]);

  const updateForm = (patch) => {
    const current = formRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    formRef.current = next;
    revisionRef.current += 1;
    setForm(next);
    setSaveError(null);
    setSaveState('saving');
  };

  const changeTheme = (theme) => {
    updateForm({ theme });
    applySettings({ ...formRef.current, theme });
  };

  const persist = async (next, revision, { notify = false } = {}) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (mountedRef.current) {
      setRequestInFlight(true);
      setSaveState('saving');
      setSaveError(null);
    }
    try {
      const data = await api('/account/settings', {
        method: 'PATCH',
        body: {
          assistantName: next.assistantName,
          theme: next.theme,
          emailNotifications: next.emailNotifications,
          pushNotifications: next.pushNotifications,
          callRecording: next.callRecording,
        },
      });
      if (!mountedRef.current || revision !== revisionRef.current) return;
      formRef.current = data.settings;
      setForm(data.settings);
      applySettings(data.settings);
      setSaveState('saved');
      setLastSavedAt(data.settings.updatedAt || new Date().toISOString());
      if (notify) toast('Einstellungen gespeichert.');
    } catch (requestError) {
      if (!mountedRef.current || revision !== revisionRef.current) return;
      setSaveState('error');
      setSaveError(requestError.message);
    } finally {
      if (mountedRef.current) setRequestInFlight(false);
    }
  };

  persistRef.current = persist;

  useEffect(() => {
    if (!initializedRef.current || !formRef.current || saveState !== 'saving') return undefined;
    const next = formRef.current;
    const revision = revisionRef.current;
    const timer = setTimeout(() => {
      timerRef.current = null;
      persist(next, revision);
    }, 700);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [form, saveState]);

  const saveSettings = (event) => {
    event.preventDefault();
    if (!formRef.current) return;
    persist(formRef.current, revisionRef.current, { notify: true });
  };

  const saveStatusText =
    saveState === 'saving'
      ? 'Wird gespeichert …'
      : saveState === 'saved'
        ? 'Gespeichert'
        : saveState === 'error'
          ? 'Speichern fehlgeschlagen'
          : 'Noch nicht gespeichert';

  if (settingsApi.loading && !settingsApi.data) {
    return <LoadingState label="Einstellungen werden geladen …" />;
  }
  if (settingsApi.error && !settingsApi.data) {
    return <ErrorState error={settingsApi.error} onRetry={settingsApi.reload} />;
  }
  if (!form) return null;

  return (
    <div className="page-stack">
      <PageHeader
        title="Einstellungen"
        description="Darstellung, Benachrichtigungen und lokale Datenverwaltung."
      />

      <div className="settings-layout">
        <form className="settings-main" onSubmit={saveSettings}>
          {saveError ? <div className="form-error">{saveError}</div> : null}

          <SectionCard title="Darstellung" description="Das Theme gilt für dieses Konto.">
            <div className="theme-options" role="radiogroup" aria-label="Theme wählen">
              {THEMES.map((theme) => {
                const Icon = theme.icon;
                return (
                  <button
                    key={theme.value}
                    type="button"
                    role="radio"
                    aria-checked={form.theme === theme.value}
                    className={`theme-option ${form.theme === theme.value ? 'active' : ''}`}
                    onClick={() => changeTheme(theme.value)}
                  >
                    <span className="theme-preview" data-preview={theme.value}>
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="theme-label">
                      <Icon size={16} /> {theme.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Assistent"
            description="Der Anzeigename ist eine lokale Bezeichnung. Die tatsächliche Agent-Zuordnung erfolgt serverseitig."
          >
            <Field
              label="Anzeigename"
              htmlFor="assistant-name"
              hint="Wird in Navigation und Dashboard angezeigt. Der ElevenLabs-Agent bleibt unverändert."
            >
              <input
                id="assistant-name"
                value={form.assistantName}
                onChange={(event) => updateForm({ assistantName: event.target.value })}
                maxLength={60}
                required
              />
            </Field>
          </SectionCard>

          <SectionCard title="Benachrichtigungen" description="Lokale Präferenzen ohne externen Versand.">
            <div className="toggle-list">
              <Toggle
                id="email-notifications"
                label="E-Mail-Hinweise"
                description="Für zukünftige Benachrichtigungsfunktionen vorgemerkt."
                checked={form.emailNotifications}
                onChange={(value) => updateForm({ emailNotifications: value })}
              />
              <Toggle
                id="push-notifications"
                label="Push-Hinweise"
                description="Derzeit nicht aktiv – es ist kein Push-Dienst eingerichtet."
                checked={form.pushNotifications}
                onChange={(value) => updateForm({ pushNotifications: value })}
              />
              <Toggle
                id="call-recording"
                label="Anrufaufzeichnung vormerken"
                description="Nur eine Präferenz. Es findet aktuell keine automatische Aufzeichnung statt."
                checked={form.callRecording}
                onChange={(value) => updateForm({ callRecording: value })}
              />
            </div>
          </SectionCard>

          <div className="form-actions">
            <span
              className={`save-status save-status-${saveState}`}
              role="status"
              aria-live="polite"
              title={lastSavedAt ? `Zuletzt gespeichert: ${lastSavedAt}` : undefined}
            >
              {saveStatusText}
            </span>
            <button type="submit" className="btn btn-primary" disabled={requestInFlight}>
              {requestInFlight ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Save size={16} />
              )}
              Einstellungen speichern
            </button>
          </div>
        </form>

        <aside className="settings-side">
          <SectionCard title="Lokale Daten" description="SQLite-Datenbank im Projektverzeichnis">
            <div className="data-note">
              <Database size={20} aria-hidden="true" />
              <p>
                Profil, Kontakte, Aufgaben, Termine, Anrufe, Transkripte und Einstellungen
                liegen in <code>data/victor.db</code>. Die Datei ist von Git ausgeschlossen.
                Backups können mit <code>npm run backup</code> erstellt werden; für einen
                konsistenten Stand nutzt das Skript die SQLite-Sicherung.
              </p>
            </div>
            <p className="muted small">
              Es werden keine Daten automatisch gelöscht oder zurückgesetzt. Testdaten werden nur
              durch deine eigenen Eingaben erzeugt.
            </p>
          </SectionCard>

          <SectionCard title="Sitzung" description="Abmeldung auf diesem Gerät">
            <p className="muted small">
              Beim Abmelden wird die serverseitige Sitzung gelöscht. Andere Geräte bleiben
              angemeldet, sofern du das Passwort nicht änderst.
            </p>
            <button type="button" className="btn btn-danger btn-block" onClick={logout}>
              <LogOut size={16} /> Abmelden
            </button>
          </SectionCard>

          <p className="version-note">Victor AI Assistant · Version 1.0.0</p>
        </aside>
      </div>
    </div>
  );
}
