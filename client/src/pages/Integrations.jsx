import { useEffect, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  Phone,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import {
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/ui.jsx';
import { formatDateTime } from '../utils/format.js';

const PROVIDER_META = {
  elevenlabs: {
    icon: AudioLines,
    title: 'ElevenLabs',
    subtitle: 'Sprachassistent',
    env: [
      'ELEVENLABS_API_KEY',
      'ELEVENLABS_AGENT_ID',
      'ELEVENLABS_PHONE_NUMBER_ID',
      'ELEVENLABS_AGENT_NAME',
    ],
  },
  zadarma: {
    icon: Phone,
    title: 'Zadarma',
    subtitle: 'Telefonie',
    env: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP_NUMBER', 'ALLOW_LIVE_CALLS'],
  },
};

const CREDENTIAL_PROVIDER_LABELS = {
  elevenlabs: 'ElevenLabs',
  zadarma: 'Zadarma',
};

const SOURCE_LABELS = {
  database: 'verschlüsselt in der Datenbank',
  environment: 'aus der Server-Umgebung',
  missing: 'noch nicht hinterlegt',
};

export default function Integrations() {
  const { data, loading, error, reload, setData } = useApi('/integrations');
  const credentialsApi = useApi('/integrations/credentials');
  const { toast } = useToast();
  const [checking, setChecking] = useState(null);
  const [credentialForms, setCredentialForms] = useState({});
  const [credentialStates, setCredentialStates] = useState({});

  useEffect(() => {
    if (!credentialsApi.data?.providers) return;
    setCredentialForms((current) => {
      const next = { ...current };
      for (const provider of credentialsApi.data.providers) {
        if (next[provider.provider]) continue;
        next[provider.provider] = Object.fromEntries(
          provider.fields.map((field) => [field.key, '']),
        );
      }
      return next;
    });
  }, [credentialsApi.data]);

  const integrations = data?.integrations || [];
  const liveCallsEnabled = Boolean(data?.liveCallsEnabled);

  const runCheck = async (provider) => {
    setChecking(provider);
    try {
      const result = await api(`/integrations/${provider}/check`, { method: 'POST' });
      setData({
        integrations: result.integrations,
        liveCallsEnabled: Boolean(result.liveCallsEnabled),
      });
      const check = result.result;
      toast(
        check.message,
        check.status === 'ok' ? 'success' : check.status === 'not_configured' ? 'info' : 'error',
      );
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setChecking(null);
    }
  };

  const saveCredentials = async (provider, event) => {
    event.preventDefault();
    const form = credentialForms[provider] || {};
    const values = Object.fromEntries(
      Object.entries(form).filter(([, value]) => String(value || '').trim() !== ''),
    );
    if (Object.keys(values).length === 0) {
      setCredentialStates((current) => ({
        ...current,
        [provider]: {
          state: 'error',
          message: 'Bitte mindestens einen Wert eingeben. Leere Felder überschreiben nichts.',
        },
      }));
      return;
    }
    setCredentialStates((current) => ({
      ...current,
      [provider]: { state: 'saving', message: 'Wird gespeichert …' },
    }));
    try {
      const result = await api(`/integrations/${provider}/credentials`, {
        method: 'PUT',
        body: values,
      });
      setCredentialForms((current) => ({
        ...current,
        [provider]: Object.fromEntries(
          Object.keys(form).map((key) => [key, '']),
        ),
      }));
      if (result.credentials) credentialsApi.setData(result.credentials);
      setCredentialStates((current) => ({
        ...current,
        [provider]: { state: 'saved', message: 'Gespeichert.' },
      }));
      toast(result.message || 'Zugangsdaten gespeichert.', 'success');
      reload();
    } catch (requestError) {
      setCredentialStates((current) => ({
        ...current,
        [provider]: {
          state: 'error',
          message: requestError.message || 'Speichern fehlgeschlagen.',
        },
      }));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Integrationen"
        description="Status der serverseitigen Verbindungen. Zugangsdaten bleiben auf dem Server."
      />

      <div className="notice notice-neutral">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Sicherheit</strong>
          <p>
            API-Schlüssel sind weder im Frontend noch in API-Antworten sichtbar. Neue Zugangsdaten
            werden mit AES-256-GCM verschlüsselt in der Datenbank gespeichert; der Schlüssel liegt
            separat außerhalb der Datenbank. Angezeigt werden nur maskierte Kennungen.
          </p>
        </div>
      </div>

      {loading && !data ? <LoadingState label="Integrationsstatus wird geladen …" /> : null}
      {error && !data ? <ErrorState error={error} onRetry={reload} /> : null}

      {integrations.length > 0 ? (
        <div className="integration-grid">
          {integrations.map((integration) => {
            const meta = PROVIDER_META[integration.provider] || {
              icon: ServerCog,
              title: integration.name,
              subtitle: 'Integration',
              env: [],
            };
            const Icon = meta.icon;
            return (
              <article key={integration.provider} className="card integration-card">
                <div className="integration-head">
                  <span className={`integration-icon ${integration.provider}`}>
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <div className="integration-title">
                    <h2>{meta.title}</h2>
                    <p>{meta.subtitle}</p>
                  </div>
                  <StatusBadge status={integration.status} type="integration" />
                </div>

                <p className="integration-message">{integration.message}</p>

                <dl className="detail-list compact">
                  <div>
                    <dt>Konfiguriert</dt>
                    <dd>{integration.configured ? 'Ja' : 'Nein'}</dd>
                  </div>
                  <div>
                    <dt>Verifiziert</dt>
                    <dd>
                      {integration.verified ? (
                        <span className="inline-success">
                          <CheckCircle2 size={14} /> Ja
                        </span>
                      ) : (
                        'Nein'
                      )}
                    </dd>
                  </div>
                  {integration.provider === 'elevenlabs' ? (
                    <>
                      <div>
                        <dt>Agent</dt>
                        <dd>{integration.agentName}</dd>
                      </div>
                      <div>
                        <dt>Agent-ID</dt>
                        <dd>
                          <code>{integration.agentIdMasked || '–'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Phone-Number-ID</dt>
                        <dd>
                          <code>{integration.phoneNumberIdMasked || '–'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>SIP-Outbound</dt>
                        <dd>{integration.outboundConfigured ? 'Bereit' : 'Nicht konfiguriert'}</dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>SIP-Nummer</dt>
                        <dd>
                          <code>{integration.sipNumberMasked || '–'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Rolle</dt>
                        <dd>SIP-Transport</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>Zuletzt geprüft</dt>
                    <dd>{integration.lastCheckedAt ? formatDateTime(integration.lastCheckedAt) : 'Noch nicht'}</dd>
                  </div>
                </dl>

                <div className="integration-env">
                  <span>
                    <KeyRound size={14} /> Benötigte Umgebungsvariablen
                  </span>
                  <div className="env-list">
                    {meta.env.map((name) => (
                      <code key={name}>{name}</code>
                    ))}
                  </div>
                </div>

                {integration.provider === 'elevenlabs' ? (
                  <p className="muted small">
                    Es wird ausschließlich der per Agent-ID zugeordnete Agent verwendet. KI-Anrufe
                    starten über <code>POST /v1/convai/sip-trunk/outbound-call</code> mit der
                    vorhandenen Phone-Number-ID; Twilio wird nicht verwendet. Eine separate
                    „Anna“-Konfiguration ist in diesem Projekt nicht vorhanden; andere Agenten
                    werden nicht verändert.
                  </p>
                ) : null}

                <div className="integration-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => runCheck(integration.provider)}
                    disabled={checking !== null}
                  >
                    {checking === integration.provider ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    Verbindung testen
                  </button>
                  {integration.provider === 'zadarma' && integration.verified ? (
                    <span className="muted small">
                      API erreichbar – ein echter Anruf wurde nicht ausgelöst.
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <SectionCard
        title="Zugangsdaten"
        description="Änderungen werden nach Bestätigung dauerhaft und verschlüsselt gespeichert. Leere Felder überschreiben keine vorhandenen Werte."
      >
        {credentialsApi.loading && !credentialsApi.data ? (
          <LoadingState label="Zugangsdaten werden geladen …" />
        ) : null}
        {credentialsApi.error && !credentialsApi.data ? (
          <ErrorState error={credentialsApi.error} onRetry={credentialsApi.reload} />
        ) : null}
        {credentialsApi.data?.storage?.warnings?.length ? (
          <div className="form-error">{credentialsApi.data.storage.warnings.join(' ')}</div>
        ) : null}
        {credentialsApi.data?.providers?.length ? (
          <div className="credentials-grid">
            {credentialsApi.data.providers.map((provider) => {
              const form = credentialForms[provider.provider] || {};
              const status = credentialStates[provider.provider];
              return (
                <form
                  key={provider.provider}
                  className="credential-form"
                  onSubmit={(event) => saveCredentials(provider.provider, event)}
                >
                  <h3>{CREDENTIAL_PROVIDER_LABELS[provider.provider] || provider.provider}</h3>
                  <p className="muted small">
                    {provider.fields.some((field) => field.configured)
                      ? 'Mindestens ein Wert ist hinterlegt. Leere Felder bleiben unverändert.'
                      : 'Noch keine Zugangsdaten hinterlegt.'}
                  </p>
                  {provider.fields.map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      htmlFor={`credential-${provider.provider}-${field.key}`}
                      hint={
                        field.configured
                          ? `Gespeichert: ${field.masked} · Quelle: ${SOURCE_LABELS[field.source] || field.source}`
                          : 'Noch nicht hinterlegt.'
                      }
                    >
                      <input
                        id={`credential-${provider.provider}-${field.key}`}
                        type="password"
                        autoComplete="new-password"
                        value={form[field.key] || ''}
                        placeholder={
                          field.configured
                            ? 'Leer lassen, um den gespeicherten Wert zu behalten'
                            : 'Wert eingeben'
                        }
                        onChange={(event) =>
                          setCredentialForms((current) => ({
                            ...current,
                            [provider.provider]: {
                              ...(current[provider.provider] || {}),
                              [field.key]: event.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                  ))}
                  <div className="credential-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={status?.state === 'saving'}
                    >
                      {status?.state === 'saving' ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <KeyRound size={15} />
                      )}
                      Zugangsdaten speichern
                    </button>
                    {status ? (
                      <span
                        className={`save-status save-status-${status.state}`}
                        role="status"
                        aria-live="polite"
                      >
                        {status.message}
                      </span>
                    ) : null}
                  </div>
                </form>
              );
            })}
          </div>
        ) : null}
      </SectionCard>

      <div className={`notice ${liveCallsEnabled ? 'notice-warning' : 'notice-info'}`}>
        <CircleAlert size={18} aria-hidden="true" />
        <div>
          <strong>Telefonie-Freigabe</strong>
          <p>
            {liveCallsEnabled
              ? 'Live-Anrufe sind serverseitig freigegeben. Jeder Anruf benötigt zusätzlich eine ausdrückliche Bestätigung im Bereich „Anrufe“.'
              : 'Live-Anrufe sind gesperrt. Anrufe können vorbereitet und protokolliert, aber nicht ausgelöst werden, solange ALLOW_LIVE_CALLS nicht auf true gesetzt ist.'}
          </p>
        </div>
      </div>

      <div className="notice notice-neutral">
        <ServerCog size={18} aria-hidden="true" />
        <div>
          <strong>Einrichtung</strong>
          <p>
            Bestehende Werte aus <code>.env</code> bleiben gültig. Neue Werte können oben
            eingegeben werden und werden serverseitig verschlüsselt gespeichert; sie werden
            weder in den Browser-Speicher noch in Logs geschrieben.
          </p>
        </div>
      </div>
    </div>
  );
}
