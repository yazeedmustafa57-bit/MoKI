import { useEffect, useState } from 'react';
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (settingsApi.data?.settings) setForm(settingsApi.data.settings);
  }, [settingsApi.data]);

  const changeTheme = (theme) => {
    setForm((current) => {
      const next = { ...current, theme };
      applySettings(next);
      return next;
    });
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const data = await api('/account/settings', {
        method: 'PATCH',
        body: {
          assistantName: form.assistantName,
          theme: form.theme,
          emailNotifications: form.emailNotifications,
          pushNotifications: form.pushNotifications,
          callRecording: form.callRecording,
        },
      });
      setForm(data.settings);
      applySettings(data.settings);
      toast('Einstellungen gespeichert.');
    } catch (requestError) {
      setSaveError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

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
                onChange={(event) =>
                  setForm((current) => ({ ...current, assistantName: event.target.value }))
                }
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
                onChange={(value) =>
                  setForm((current) => ({ ...current, emailNotifications: value }))
                }
              />
              <Toggle
                id="push-notifications"
                label="Push-Hinweise"
                description="Derzeit nicht aktiv – es ist kein Push-Dienst eingerichtet."
                checked={form.pushNotifications}
                onChange={(value) =>
                  setForm((current) => ({ ...current, pushNotifications: value }))
                }
              />
              <Toggle
                id="call-recording"
                label="Anrufaufzeichnung vormerken"
                description="Nur eine Präferenz. Es findet aktuell keine automatische Aufzeichnung statt."
                checked={form.callRecording}
                onChange={(value) => setForm((current) => ({ ...current, callRecording: value }))}
              />
            </div>
          </SectionCard>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              Einstellungen speichern
            </button>
          </div>
        </form>

        <aside className="settings-side">
          <SectionCard title="Lokale Daten" description="SQLite-Datenbank im Projektverzeichnis">
            <div className="data-note">
              <Database size={20} aria-hidden="true" />
              <p>
                Profil, Kontakte, Aufgaben, Termine, Anrufe und Transkripte liegen in
                <code>data/victor.db</code>. Die Datei ist von Git ausgeschlossen. Vor einem
                Backup den Server stoppen und die Datei kopieren.
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
