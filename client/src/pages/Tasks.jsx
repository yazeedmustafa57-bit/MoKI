import { useState } from 'react';
import {
  CalendarDays,
  Check,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useApi } from '../hooks/useApi.js';
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui.jsx';
import { formatDateOnly, relativeDay } from '../utils/format.js';

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'open', label: 'Offen' },
  { value: 'in_progress', label: 'In Arbeit' },
  { value: 'done', label: 'Erledigt' },
];

const emptyForm = {
  title: '',
  description: '',
  status: 'open',
  priority: 'medium',
  dueDate: '',
  contactId: '',
};

export default function Tasks() {
  const [filter, setFilter] = useState('all');
  const tasksApi = useApi(`/tasks${filter === 'all' ? '' : `?status=${filter}`}`);
  const contactsApi = useApi('/contacts');
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const tasks = tasksApi.data?.tasks || [];
  const contacts = contactsApi.data?.contacts || [];

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setModal({ type: 'edit', task: null });
  };

  const openEdit = (task) => {
    setForm({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate || '',
      contactId: task.contactId || '',
    });
    setFormError(null);
    setModal({ type: 'edit', task });
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setFormError(null);
  };

  const saveTask = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const body = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate || null,
      contactId: form.contactId || null,
    };
    try {
      if (modal?.task) {
        await api(`/tasks/${modal.task.id}`, { method: 'PATCH', body });
        toast('Aufgabe aktualisiert.');
      } else {
        await api('/tasks', { method: 'POST', body });
        toast('Aufgabe angelegt.');
      }
      setModal(null);
      tasksApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDone = async (task) => {
    setBusyId(task.id);
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: task.status === 'done' ? 'open' : 'done' },
      });
      toast(task.status === 'done' ? 'Aufgabe wieder geöffnet.' : 'Aufgabe erledigt.');
      tasksApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteTask = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api(`/tasks/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Aufgabe gelöscht.');
      setDeleteTarget(null);
      tasksApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Aufgaben"
        description="Behalte offene Punkte im Blick und verknüpfe sie mit Kontakten."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={17} /> Neue Aufgabe
          </button>
        }
      />

      <div className="filter-row" role="group" aria-label="Aufgaben filtern">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`chip ${filter === item.value ? 'active' : ''}`}
            onClick={() => setFilter(item.value)}
            aria-pressed={filter === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tasksApi.loading && !tasksApi.data ? <LoadingState label="Aufgaben werden geladen …" /> : null}
      {tasksApi.error && !tasksApi.data ? (
        <ErrorState error={tasksApi.error} onRetry={tasksApi.reload} />
      ) : null}

      {tasksApi.data && tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ListChecks}
            title={filter === 'all' ? 'Noch keine Aufgaben' : 'Keine Aufgaben in diesem Filter'}
            description="Lege eine Aufgabe an, um deinen nächsten Schritt festzuhalten."
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={16} /> Aufgabe anlegen
              </button>
            }
          />
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`card task-item ${task.status === 'done' ? 'done' : ''}`}>
              <button
                type="button"
                className={`task-check task-check-lg ${task.status === 'done' ? 'checked' : ''}`}
                onClick={() => toggleDone(task)}
                disabled={busyId === task.id}
                aria-label={
                  task.status === 'done'
                    ? `Aufgabe „${task.title}“ wieder öffnen`
                    : `Aufgabe „${task.title}“ als erledigt markieren`
                }
              >
                {busyId === task.id ? <LoaderCircle size={14} className="spin" /> : <Check size={15} />}
              </button>
              <div className="task-content">
                <div className="task-title-row">
                  <strong>{task.title}</strong>
                  <StatusBadge status={task.priority} type="priority" />
                </div>
                {task.description ? <p>{task.description}</p> : null}
                <div className="task-meta">
                  <StatusBadge status={task.status} type="task" />
                  {task.dueDate ? (
                    <span className={task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== 'done' ? 'overdue' : ''}>
                      <CalendarDays size={14} /> {relativeDay(`${task.dueDate}T12:00:00`)} ·{' '}
                      {formatDateOnly(task.dueDate)}
                    </span>
                  ) : null}
                  {task.contactName ? <span>{task.contactName}</span> : null}
                </div>
              </div>
              <div className="task-actions">
                <button type="button" className="icon-btn" onClick={() => openEdit(task)} aria-label="Aufgabe bearbeiten">
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => setDeleteTarget(task)}
                  aria-label="Aufgabe löschen"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={modal?.type === 'edit'}
        onClose={closeModal}
        title={modal?.task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
        description="Titel und Fälligkeit helfen dir, den Überblick zu behalten."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="task-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : null}
              Speichern
            </button>
          </>
        }
      >
        <form id="task-form" className="form-grid" onSubmit={saveTask}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Titel" htmlFor="task-title" className="form-grid-full">
            <input
              id="task-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Was ist zu tun?"
              data-autofocus
              required
            />
          </Field>
          <Field label="Beschreibung" htmlFor="task-description" className="form-grid-full">
            <textarea
              id="task-description"
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Zusätzliche Details (optional)"
            />
          </Field>
          <Field label="Status" htmlFor="task-status">
            <select
              id="task-status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="open">Offen</option>
              <option value="in_progress">In Arbeit</option>
              <option value="done">Erledigt</option>
            </select>
          </Field>
          <Field label="Priorität" htmlFor="task-priority">
            <select
              id="task-priority"
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
            >
              <option value="low">Niedrig</option>
              <option value="medium">Mittel</option>
              <option value="high">Hoch</option>
            </select>
          </Field>
          <Field label="Fällig am" htmlFor="task-due">
            <input
              id="task-due"
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </Field>
          <Field label="Kontakt" htmlFor="task-contact">
            <select
              id="task-contact"
              value={form.contactId}
              onChange={(event) => setForm((current) => ({ ...current, contactId: event.target.value }))}
            >
              <option value="">Kein Kontakt</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Aufgabe löschen?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteTask} disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Löschen
            </button>
          </>
        }
      >
        <p>
          „{deleteTarget?.title}“ wird dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht
          werden.
        </p>
      </Modal>
    </div>
  );
}
