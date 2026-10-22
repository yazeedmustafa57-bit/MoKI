import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AudioLines,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Mic,
  MicOff,
  RefreshCw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/ui.jsx';
import { formatDateTime } from '../utils/format.js';

const STATUS_LABEL = {
  disconnected: 'Nicht verbunden',
  connecting: 'Verbindung wird aufgebaut',
  connected: 'Verbunden',
  disconnecting: 'Sitzung wird beendet',
};

export default function Talk() {
  const { data, loading, error, reload, setData } = useApi('/assistant/status');
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('disconnected');
  const [mode, setMode] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionError, setSessionError] = useState(null);
  const sessionRef = useRef(null);

  useEffect(
    () => () => {
      sessionRef.current?.endSession?.().catch(() => {});
      sessionRef.current = null;
    },
    [],
  );

  const assistant = data?.assistant;

  const checkConnection = async () => {
    setChecking(true);
    try {
      const result = await api('/integrations/elevenlabs/check', { method: 'POST' });
      const updated = result.integrations.find((item) => item.provider === 'elevenlabs');
      if (assistant && updated) {
        setData((current) => ({ assistant: { ...current.assistant, ...updated } }));
      }
      toast(
        updated?.status === 'ok' ? updated.message : updated?.message || 'Prüfung abgeschlossen.',
        updated?.status === 'ok' ? 'success' : 'info',
      );
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  const startSession = async () => {
    setSessionError(null);
    setMessages([]);
    setStarting(true);
    setSessionStatus('connecting');
    try {
      const session = await api('/assistant/session', { method: 'POST' });
      const { Conversation } = await import('@elevenlabs/client');
      const conversation = await Conversation.startSession({
        signedUrl: session.signedUrl,
        onConnect: () => {
          setSessionStatus('connected');
          toast('Sprachsitzung mit Victor ist verbunden.');
        },
        onDisconnect: () => {
          setSessionStatus('disconnected');
          setMode(null);
          sessionRef.current = null;
        },
        onStatusChange: ({ status }) => setSessionStatus(status),
        onModeChange: ({ mode: nextMode }) => setMode(nextMode),
        onMessage: (message) => {
          if (!message?.message) return;
          setMessages((current) => [
            ...current.slice(-40),
            {
              id: `${message.event_id}-${message.response_id || ''}`,
              role: message.role || (message.source === 'ai' ? 'agent' : 'user'),
              text: message.message,
            },
          ]);
        },
        onError: (message) => {
          const friendly = message || 'Die Sprachsitzung meldet einen Fehler.';
          setSessionError(friendly);
          setSessionStatus('disconnected');
          toast(friendly, 'error');
        },
      });
      sessionRef.current = conversation;
    } catch (requestError) {
      setSessionStatus('disconnected');
      let message = requestError.message;
      if (requestError?.name === 'NotAllowedError') {
        message = 'Der Zugriff auf das Mikrofon wurde verweigert. Bitte erlaube ihn in den Browser-Einstellungen.';
      }
      setSessionError(message);
      toast(message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const endSession = async () => {
    setSessionStatus('disconnecting');
    try {
      await sessionRef.current?.endSession?.();
    } catch {
      // Ignore shutdown errors.
    } finally {
      sessionRef.current = null;
      setSessionStatus('disconnected');
      setMode(null);
    }
  };

  const sessionActive = sessionStatus === 'connected' || sessionStatus === 'connecting';

  return (
    <div className="page-stack">
      <PageHeader
        title="Mit Victor sprechen"
        description="Starte eine Sprachsitzung mit deinem ElevenLabs-Agenten. Das Mikrofon wird erst nach deinem Klick aktiviert."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={checkConnection}
            disabled={checking}
          >
            {checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
            Verbindung prüfen
          </button>
        }
      />

      {loading && !assistant ? <LoadingState label="Assistentenstatus wird geladen …" /> : null}
      {error && !assistant ? <ErrorState error={error} onRetry={reload} /> : null}

      {assistant ? (
        <div className="talk-layout">
          <section className="card talk-stage">
            <div className={`talk-orb ${sessionStatus} ${mode || ''}`} aria-hidden="true">
              <span className="orb-ring ring-one" />
              <span className="orb-ring ring-two" />
              <span className="orb-core">
                <AudioLines size={34} />
              </span>
            </div>
            <div className="talk-stage-copy">
              <span className="eyebrow">ElevenLabs · {assistant.agentName}</span>
              <h2>{STATUS_LABEL[sessionStatus] || sessionStatus}</h2>
              <p>
                {sessionStatus === 'connected'
                  ? mode === 'speaking'
                    ? 'Victor spricht. Du kannst jederzeit unterbrechen.'
                    : 'Victor hört zu. Sprich einfach los.'
                  : assistant.configured
                    ? 'Die Verbindung ist serverseitig konfiguriert. Starte die Sitzung bewusst per Klick.'
                    : 'Victor ist noch nicht mit ElevenLabs verbunden. Hinterlege die Zugangsdaten auf dem Server.'}
              </p>
            </div>

            {sessionError ? (
              <div className="notice notice-error" role="alert">
                <CircleAlert size={18} />
                <p>{sessionError}</p>
              </div>
            ) : null}

            <div className="talk-actions">
              {sessionActive ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={endSession}
                  disabled={sessionStatus === 'disconnecting'}
                >
                  {sessionStatus === 'disconnecting' ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Square size={15} />
                  )}
                  Sitzung beenden
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={startSession}
                  disabled={!assistant.configured || starting}
                >
                  {starting ? <LoaderCircle size={18} className="spin" /> : <Mic size={18} />}
                  {starting ? 'Sitzung wird gestartet …' : 'Sprachsitzung starten'}
                </button>
              )}
            </div>
            <p className="talk-hint">
              <ShieldCheck size={15} aria-hidden="true" />
              Kein API-Schlüssel im Browser. Die Sitzungs-URL wird ausschließlich serverseitig
              erzeugt.
            </p>
          </section>

          <div className="talk-side">
            <SectionCard title="Agent" description="Zuordnung aus der Serverkonfiguration">
              <dl className="detail-list">
                <div>
                  <dt>Name</dt>
                  <dd>{assistant.agentName}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={assistant.status} type="integration" />
                  </dd>
                </div>
                <div>
                  <dt>Agent-ID</dt>
                  <dd>
                    <code>{assistant.agentIdMasked || '–'}</code>
                  </dd>
                </div>
                <div>
                  <dt>Zuletzt geprüft</dt>
                  <dd>{assistant.lastCheckedAt ? formatDateTime(assistant.lastCheckedAt) : 'Noch nicht'}</dd>
                </div>
              </dl>
              <p className="muted small">{assistant.message}</p>
              <Link to="/integrations" className="text-link">
                Integrationen verwalten <ExternalLink size={14} />
              </Link>
            </SectionCard>

            <SectionCard title="Live-Transkript" description="Nur für die aktuelle Sitzung, nicht gespeichert">
              {messages.length === 0 ? (
                <div className="live-empty">
                  <MicOff size={18} aria-hidden="true" />
                  <span>Noch keine Gesprächsbeiträge.</span>
                </div>
              ) : (
                <ul className="live-messages">
                  {messages.map((message) => (
                    <li key={message.id} className={message.role === 'agent' ? 'agent' : 'user'}>
                      <span>{message.role === 'agent' ? assistant.agentName : 'Du'}</span>
                      <p>{message.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">
                Möchtest du ein Gespräch dauerhaft sichern? Lege anschließend ein Transkript an.
              </p>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </div>
  );
}
