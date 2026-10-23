import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  AudioLines,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  ListChecks,
  Phone,
  PhoneCall,
  Plus,
  Users,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
  SectionCard,
  StatusBadge,
} from '../components/ui.jsx';
import {
  formatDateTime,
  formatDuration,
  formatTime,
  greeting,
  relativeDay,
} from '../utils/format.js';

function Metric({ icon: Icon, label, value, to }) {
  return (
    <Link to={to} className="metric-card">
      <span className="metric-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
      <ChevronRight size={16} className="metric-arrow" aria-hidden="true" />
    </Link>
  );
}

export default function Dashboard() {
  const { data, loading, error, reload } = useApi('/dashboard');
  const [busyTask, setBusyTask] = useState(null);
  const { toast } = useToast();

  const completeTask = async (task) => {
    setBusyTask(task.id);
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'done' } });
      toast('Aufgabe als erledigt markiert.');
      reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setBusyTask(null);
    }
  };

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const { user, assistant, telephony, counts, recentCalls, openTasks, upcomingAppointments, latestTranscripts } =
    data;

  return (
    <div className="page-stack">
      <section className="welcome-block">
        <div>
          <span className="eyebrow">Übersicht</span>
          <h1>{greeting(user.name)}</h1>
          <p>Hier ist der aktuelle Stand deines Assistenten und deiner Kommunikation.</p>
        </div>
        <div className="welcome-actions">
          <Link to="/talk" className="btn btn-primary">
            <AudioLines size={17} /> Mit Victor sprechen
          </Link>
          <Link to="/calls" className="btn btn-secondary">
            <Phone size={17} /> Anruf vorbereiten
          </Link>
        </div>
      </section>

      <div className="metric-grid">
        <Metric icon={ListChecks} label="Offene Aufgaben" value={counts.openTasks} to="/tasks" />
        <Metric
          icon={CalendarDays}
          label="Anstehende Termine"
          value={counts.upcomingAppointments}
          to="/calendar"
        />
        <Metric icon={Users} label="Kontakte" value={counts.contacts} to="/contacts" />
        <Metric icon={PhoneCall} label="Anrufe gesamt" value={counts.calls} to="/calls" />
      </div>

      <div className="status-grid">
        <article className="card status-card">
          <div className="status-card-head">
            <span className="status-icon assistant">
              <AudioLines size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{assistant.agentName}</strong>
              <small>Sprachassistent</small>
            </div>
            <StatusBadge status={assistant.status} type="integration" />
          </div>
          <p>{assistant.message}</p>
          <div className="status-card-foot">
            <code>{assistant.agentIdMasked || 'Keine Agent-ID'}</code>
            <Link to="/talk">
              Öffnen <ArrowRight size={14} />
            </Link>
          </div>
        </article>

        <article className="card status-card">
          <div className="status-card-head">
            <span className="status-icon telephony">
              <Phone size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>ElevenLabs</strong>
              <small>SIP-Outbound</small>
            </div>
            <StatusBadge status={telephony.status} type="integration" />
          </div>
          <p>{telephony.message}</p>
          <div className="status-card-foot">
            <code>{telephony.phoneNumberIdMasked || 'Keine Phone-Number-ID'}</code>
            <Link to="/integrations">
              Details <ArrowRight size={14} />
            </Link>
          </div>
        </article>

        <article className="card status-card quick-card">
          <div className="status-card-head">
            <span className="status-icon neutral">
              <Plus size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>Schnelle Aktionen</strong>
              <small>Direkt loslegen</small>
            </div>
          </div>
          <div className="quick-links">
            <Link to="/tasks">
              <ListChecks size={16} /> Aufgabe
            </Link>
            <Link to="/contacts">
              <Users size={16} /> Kontakt
            </Link>
            <Link to="/calendar">
              <CalendarDays size={16} /> Termin
            </Link>
            <Link to="/transcripts">
              <FileText size={16} /> Transkript
            </Link>
          </div>
        </article>
      </div>

      <div className="dashboard-grid">
        <SectionCard
          title="Letzte Anrufe"
          action={
            <Link to="/calls" className="text-link">
              Alle anzeigen <ChevronRight size={15} />
            </Link>
          }
        >
          {recentCalls.length === 0 ? (
            <EmptyState
              compact
              icon={Phone}
              title="Noch keine Anrufe"
              description="Bereite einen Anruf vor – gestartet wird er erst nach deiner Bestätigung."
              action={
                <Link to="/calls" className="btn btn-secondary btn-sm">
                  Anruf vorbereiten
                </Link>
              }
            />
          ) : (
            <ul className="compact-list">
              {recentCalls.map((call) => (
                <li key={call.id} className="compact-row">
                  <span className={`call-direction ${call.direction}`}>
                    <Phone size={15} aria-hidden="true" />
                  </span>
                  <div className="compact-main">
                    <strong>{call.contactName || call.phone || 'Unbekannt'}</strong>
                    <small>
                      {formatDateTime(call.createdAt)} · {formatDuration(call.durationSeconds)}
                    </small>
                  </div>
                  <StatusBadge status={call.status} type="call" />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Aktuelle Aufgaben"
          action={
            <Link to="/tasks" className="text-link">
              Alle anzeigen <ChevronRight size={15} />
            </Link>
          }
        >
          {openTasks.length === 0 ? (
            <EmptyState
              compact
              icon={Check}
              title="Alles erledigt"
              description="Aktuell sind keine offenen Aufgaben vorhanden."
            />
          ) : (
            <ul className="compact-list">
              {openTasks.map((task) => (
                <li key={task.id} className="compact-row">
                  <button
                    type="button"
                    className="task-check"
                    onClick={() => completeTask(task)}
                    disabled={busyTask === task.id}
                    aria-label={`Aufgabe „${task.title}“ als erledigt markieren`}
                  >
                    <Check size={14} />
                  </button>
                  <div className="compact-main">
                    <strong>{task.title}</strong>
                    <small>
                      {task.dueDate ? `Fällig ${relativeDay(`${task.dueDate}T12:00:00`)}` : 'Ohne Fälligkeit'}
                      {task.contactName ? ` · ${task.contactName}` : ''}
                    </small>
                  </div>
                  <StatusBadge status={task.priority} type="priority" />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Anstehende Termine"
          action={
            <Link to="/calendar" className="text-link">
              Kalender <ChevronRight size={15} />
            </Link>
          }
        >
          {upcomingAppointments.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarDays}
              title="Keine anstehenden Termine"
              description="Dein Kalender ist für die nächste Zeit frei."
            />
          ) : (
            <ul className="appointment-list">
              {upcomingAppointments.map((appointment) => (
                <li key={appointment.id}>
                  <span className="date-chip">
                    <strong>{relativeDay(appointment.startsAt)}</strong>
                    <small>{formatTime(appointment.startsAt)}</small>
                  </span>
                  <div className="compact-main">
                    <strong>{appointment.title}</strong>
                    <small>
                      {appointment.location || 'Ohne Ort'}
                      {appointment.contactName ? ` · ${appointment.contactName}` : ''}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Letzte Transkripte"
          action={
            <Link to="/transcripts" className="text-link">
              Alle anzeigen <ChevronRight size={15} />
            </Link>
          }
        >
          {latestTranscripts.length === 0 ? (
            <EmptyState
              compact
              icon={FileText}
              title="Noch keine Transkripte"
              description="Gespeicherte Gesprächsnotizen erscheinen hier."
            />
          ) : (
            <ul className="compact-list">
              {latestTranscripts.map((transcript) => (
                <li key={transcript.id} className="compact-row">
                  <span className="call-direction neutral">
                    <FileText size={15} aria-hidden="true" />
                  </span>
                  <div className="compact-main">
                    <strong>{transcript.title}</strong>
                    <small>{transcript.summary || formatDateTime(transcript.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {!assistant.configured || !telephony.configured ? (
        <div className="notice notice-info">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Integrationen einrichten</strong>
            <p>
              Solange ElevenLabs nicht vollständig konfiguriert ist, bleiben Sprachsitzungen und
              KI-Anrufe deaktiviert. Die Anwendung funktioniert ohne diese Dienste weiter.
            </p>
          </div>
          <Link to="/integrations" className="btn btn-secondary btn-sm">
            Status prüfen
          </Link>
        </div>
      ) : null}
    </div>
  );
}
