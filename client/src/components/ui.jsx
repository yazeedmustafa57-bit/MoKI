import {
  AlertCircle,
  Inbox,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { initials } from '../utils/format.js';

export function Avatar({ name, color = '#2563eb', size = 'md', className = '' }) {
  const dimension = size === 'lg' ? 56 : size === 'sm' ? 32 : 40;
  return (
    <span
      className={`avatar avatar-${size} ${className}`}
      style={{
        width: dimension,
        height: dimension,
        backgroundColor: color,
        fontSize: size === 'lg' ? 20 : size === 'sm' ? 12 : 15,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', dot = false, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const CALL_STATUS = {
  prepared: { label: 'Vorbereitet', tone: 'warning' },
  dialing: { label: 'Wird gewählt', tone: 'info' },
  completed: { label: 'Abgeschlossen', tone: 'success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger' },
  declined: { label: 'Abgelehnt', tone: 'neutral' },
};

const TASK_STATUS = {
  open: { label: 'Offen', tone: 'warning' },
  in_progress: { label: 'In Arbeit', tone: 'info' },
  done: { label: 'Erledigt', tone: 'success' },
};

const PRIORITY = {
  low: { label: 'Niedrig', tone: 'neutral' },
  medium: { label: 'Mittel', tone: 'info' },
  high: { label: 'Hoch', tone: 'danger' },
};

const APPOINTMENT_STATUS = {
  scheduled: { label: 'Geplant', tone: 'info' },
  completed: { label: 'Abgeschlossen', tone: 'success' },
  cancelled: { label: 'Abgesagt', tone: 'neutral' },
};

const INTEGRATION_STATUS = {
  ok: { label: 'Verbunden', tone: 'success' },
  configured: { label: 'Konfiguriert', tone: 'info' },
  not_configured: { label: 'Nicht konfiguriert', tone: 'neutral' },
  error: { label: 'Fehler', tone: 'danger' },
};

const CONVERSATION_STATUS = {
  initiated: { label: 'Initiiert', tone: 'info' },
  'in-progress': { label: 'Läuft', tone: 'info' },
  processing: { label: 'Wird verarbeitet', tone: 'warning' },
  done: { label: 'Beim Anbieter abgeschlossen', tone: 'success' },
  failed: { label: 'Anbieterfehler', tone: 'danger' },
};

const CONVERSATION_RESULT = {
  pending: { label: 'Ergebnis ausstehend', tone: 'neutral' },
  successful: { label: 'Erfolgreich', tone: 'success' },
  unsuccessful: { label: 'Nicht erfolgreich', tone: 'danger' },
  failed: { label: 'Gespräch fehlgeschlagen', tone: 'danger' },
  unclear: { label: 'Ergebnis unklar', tone: 'warning' },
  unknown: { label: 'Nicht bewertet', tone: 'neutral' },
};

const TRANSCRIPT_STATUS = {
  none: { label: 'Kein Transkript', tone: 'neutral' },
  pending: { label: 'Transkript ausstehend', tone: 'neutral' },
  processing: { label: 'Transkript wird erstellt', tone: 'warning' },
  available: { label: 'Transkript verfügbar', tone: 'success' },
  unavailable: { label: 'Kein Transkript verfügbar', tone: 'neutral' },
};

export function StatusBadge({ status, type = 'call' }) {
  const maps = {
    call: CALL_STATUS,
    task: TASK_STATUS,
    priority: PRIORITY,
    appointment: APPOINTMENT_STATUS,
    integration: INTEGRATION_STATUS,
    conversation: CONVERSATION_STATUS,
    result: CONVERSATION_RESULT,
    transcript: TRANSCRIPT_STATUS,
  };
  const meta = maps[type]?.[status] || { label: status || 'Unbekannt', tone: 'neutral' };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <span className="empty-icon">
        <Icon size={compact ? 20 : 26} aria-hidden="true" />
      </span>
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }) {
  return (
    <div className={`error-state ${compact ? 'error-state-compact' : ''}`} role="alert">
      <AlertCircle size={compact ? 20 : 24} aria-hidden="true" />
      <div>
        <strong>Daten konnten nicht geladen werden</strong>
        <p>{error?.message || 'Unbekannter Fehler.'}</p>
        {error?.code ? <code>{error.code}</code> : null}
      </div>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Daten werden geladen …', compact = false }) {
  return (
    <div className={`loading-state ${compact ? 'loading-state-compact' : ''}`} role="status">
      <LoaderCircle size={20} className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Seite wird geladen">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="skeleton skeleton-card" key={index} />
        ))}
      </div>
      <div className="skeleton skeleton-block" />
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <span className="field-error">{error}</span> : null}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function SectionCard({ title, description, action, children, className = '' }) {
  return (
    <section className={`card section-card ${className}`}>
      {title || action ? (
        <div className="section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
