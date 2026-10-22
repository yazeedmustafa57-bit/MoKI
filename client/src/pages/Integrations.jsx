import { useState } from 'react';
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
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui.jsx';
import { formatDateTime } from '../utils/format.js';

const PROVIDER_META = {
  elevenlabs: {
    icon: AudioLines,
    title: 'ElevenLabs',
    subtitle: 'Sprachassistent',
    env: ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_AGENT_NAME'],
  },
  zadarma: {
    icon: Phone,
    title: 'Zadarma',
    subtitle: 'Telefonie',
    env: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP_NUMBER', 'ALLOW_LIVE_CALLS'],
  },
};

export default function Integrations() {
  const { data, loading, error, reload, setData } = useApi('/integrations');
  const { toast } = useToast();
  const [checking, setChecking] = useState(null);

  const integrations = data?.integrations || [];
  const liveCallsEnabled = Boolean(data?.liveCallsEnabled);

  const runCheck = async (provider) => {
    setChecking(provider);
    try {
      const result = await api(`/integrations/${provider}/check`, { method: 'POST' });
      setData({
        integrations: result.integrations,
        liveCallsEnabled: Boolean(
          result.integrations.find((item) => item.provider === 'zadarma')?.liveCallsEnabled,
        ),
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

  return (
    <div className="page-stack">
      <PageHeader
        title="Integrationen"
        description="Status der serverseitigen Verbindungen. Zugangsdaten werden ausschließlich über Umgebungsvariablen gelesen."
      />

      <div className="notice notice-neutral">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Sicherheit</strong>
          <p>
            API-Schlüssel sind weder im Frontend noch in API-Antworten sichtbar. Die Prüfung läuft
            über den Server; angezeigt werden nur maskierte Kennungen.
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
                        <dt>Live-Anrufe</dt>
                        <dd>{integration.liveCallsEnabled ? 'Freigegeben' : 'Gesperrt'}</dd>
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
                    Es wird ausschließlich der per Agent-ID zugeordnete Agent verwendet. Eine
                    separate „Anna“-Konfiguration ist in diesem Projekt nicht vorhanden; andere
                    Agenten werden nicht verändert.
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
            Trage die Werte in eine lokale <code>.env</code>-Datei ein (Vorlage:
            <code>.env.example</code>) und starte den Server neu. Werte werden nie über die
            Oberfläche eingegeben oder gespeichert.
          </p>
        </div>
      </div>
    </div>
  );
}
