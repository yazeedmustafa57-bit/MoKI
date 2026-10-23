import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  LoaderCircle,
  MapPin,
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
import { formatTime, toLocalDateTimeIso, toLocalInputValue } from '../utils/format.js';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function dayKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date);
}

const emptyForm = {
  title: '',
  description: '',
  date: '',
  startTime: '09:00',
  endTime: '10:00',
  location: '',
  contactId: '',
  status: 'scheduled',
};

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), [cursor]);
  const path = `/appointments?from=${encodeURIComponent(
    monthStart.toISOString(),
  )}&to=${encodeURIComponent(monthEnd.toISOString())}`;
  const appointmentsApi = useApi(path);
  const contactsApi = useApi('/contacts');
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const contacts = contactsApi.data?.contacts || [];
  const appointments = appointmentsApi.data?.appointments || [];

  const appointmentsByDay = useMemo(() => {
    const map = new Map();
    for (const appointment of appointments) {
      const key = dayKey(new Date(appointment.startsAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(appointment);
    }
    return map;
  }, [appointments]);

  const cells = useMemo(() => {
    const firstWeekday = (monthStart.getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: total }, (_, index) => {
      const date = new Date(monthStart);
      date.setDate(monthStart.getDate() - firstWeekday + index);
      return {
        date,
        key: dayKey(date),
        inMonth: date.getMonth() === cursor.getMonth(),
        isToday: dayKey(date) === dayKey(new Date()),
      };
    });
  }, [cursor, monthStart]);

  const moveMonth = (offset) => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1));
  };

  const openCreate = (date = new Date()) => {
    setForm({
      ...emptyForm,
      date: dayKey(date),
      startTime: '09:00',
      endTime: '10:00',
    });
    setFormError(null);
    setModal({ type: 'edit', appointment: null });
  };

  const openEdit = (appointment) => {
    const start = toLocalInputValue(appointment.startsAt);
    const end = toLocalInputValue(appointment.endsAt);
    setForm({
      title: appointment.title,
      description: appointment.description,
      date: start.slice(0, 10),
      startTime: start.slice(11, 16),
      endTime: end ? end.slice(11, 16) : '',
      location: appointment.location,
      contactId: appointment.contactId || '',
      status: appointment.status,
    });
    setFormError(null);
    setModal({ type: 'edit', appointment });
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setFormError(null);
  };

  const saveAppointment = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const startsAt = toLocalDateTimeIso(`${form.date}T${form.startTime || '09:00'}`);
    const endsAt = form.endTime ? toLocalDateTimeIso(`${form.date}T${form.endTime}`) : null;
    if (!startsAt) {
      setFormError('Bitte wähle ein gültiges Startdatum.');
      setSubmitting(false);
      return;
    }
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      setFormError('Die Endzeit muss nach der Startzeit liegen.');
      setSubmitting(false);
      return;
    }
    const body = {
      title: form.title,
      description: form.description,
      startsAt,
      endsAt,
      location: form.location,
      contactId: form.contactId || null,
      status: form.status,
    };
    try {
      if (modal?.appointment) {
        await api(`/appointments/${modal.appointment.id}`, { method: 'PATCH', body });
        toast('Termin aktualisiert.');
      } else {
        await api('/appointments', { method: 'POST', body });
        toast('Termin angelegt.');
      }
      setModal(null);
      appointmentsApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAppointment = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api(`/appointments/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Termin gelöscht.');
      setDeleteTarget(null);
      appointmentsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Kalender"
        description="Plane Termine und verknüpfe sie mit Kontakten."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
            <Plus size={17} /> Termin anlegen
          </button>
        }
      />

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" className="icon-btn" onClick={() => moveMonth(-1)} aria-label="Vorheriger Monat">
            <ChevronLeft size={19} />
          </button>
          <h2>{monthLabel(cursor)}</h2>
          <button type="button" className="icon-btn" onClick={() => moveMonth(1)} aria-label="Nächster Monat">
            <ChevronRight size={19} />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          Heute
        </button>
      </div>

      {appointmentsApi.loading && !appointmentsApi.data ? (
        <LoadingState label="Termine werden geladen …" />
      ) : null}
      {appointmentsApi.error && !appointmentsApi.data ? (
        <ErrorState error={appointmentsApi.error} onRetry={appointmentsApi.reload} />
      ) : null}

      <div className="card calendar-card">
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((cell) => {
            const dayAppointments = appointmentsByDay.get(cell.key) || [];
            return (
              <div
                key={cell.key}
                className={`calendar-cell ${cell.inMonth ? '' : 'outside'} ${cell.isToday ? 'today' : ''}`}
              >
                <button
                  type="button"
                  className="day-number"
                  onClick={() => openCreate(cell.date)}
                  aria-label={`Termin am ${cell.date.toLocaleDateString('de-DE')} anlegen`}
                >
                  {cell.date.getDate()}
                </button>
                <div className="calendar-events">
                  {dayAppointments.slice(0, 3).map((appointment) => (
                    <button
                      key={appointment.id}
                      type="button"
                      className={`calendar-event status-${appointment.status}`}
                      onClick={() => openEdit(appointment)}
                      title={`${formatTime(appointment.startsAt)} ${appointment.title}`}
                    >
                      <span className="event-time">{formatTime(appointment.startsAt)}</span>
                      <span className="event-title">{appointment.title}</span>
                    </button>
                  ))}
                  {dayAppointments.length > 3 ? (
                    <span className="event-more">+{dayAppointments.length - 3} weitere</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section className="card section-card">
        <div className="section-head">
          <div>
            <h2>Termine im Monat</h2>
            <p>{appointments.length} Termine in {monthLabel(cursor)}</p>
          </div>
        </div>
        {appointments.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarDays}
            title="Keine Termine in diesem Monat"
            description="Klicke auf einen Tag oder lege einen neuen Termin an."
          />
        ) : (
          <ul className="appointment-detail-list">
            {appointments.map((appointment) => (
              <li key={appointment.id}>
                <div className="appointment-date">
                  <strong>{new Intl.DateTimeFormat('de-DE', { day: '2-digit' }).format(new Date(appointment.startsAt))}</strong>
                  <small>{new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(appointment.startsAt))}</small>
                </div>
                <div className="appointment-main">
                  <div className="appointment-title-row">
                    <strong>{appointment.title}</strong>
                    <StatusBadge status={appointment.status} type="appointment" />
                  </div>
                  <div className="appointment-meta">
                    <span>
                      <Clock size={14} />
                      {formatTime(appointment.startsAt)}
                      {appointment.endsAt ? `–${formatTime(appointment.endsAt)}` : ''}
                    </span>
                    {appointment.location ? (
                      <span>
                        <MapPin size={14} /> {appointment.location}
                      </span>
                    ) : null}
                    {appointment.contactName ? <span>{appointment.contactName}</span> : null}
                  </div>
                </div>
                <div className="cell-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openEdit(appointment)}
                    aria-label="Termin bearbeiten"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => setDeleteTarget(appointment)}
                    aria-label="Termin löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={modal?.type === 'edit'}
        onClose={closeModal}
        title={modal?.appointment ? 'Termin bearbeiten' : 'Neuer Termin'}
        description="Datum, Uhrzeit und Kontaktzuordnung werden gespeichert."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="appointment-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : null}
              Speichern
            </button>
          </>
        }
      >
        <form id="appointment-form" className="form-grid" onSubmit={saveAppointment}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Titel" htmlFor="appointment-title" className="form-grid-full">
            <input
              id="appointment-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Worum geht es?"
              data-autofocus
              required
            />
          </Field>
          <Field label="Datum" htmlFor="appointment-date">
            <input
              id="appointment-date"
              type="date"
              value={form.date}
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              required
            />
          </Field>
          <div className="time-row">
            <Field label="Beginn" htmlFor="appointment-start">
              <input
                id="appointment-start"
                type="time"
                value={form.startTime}
                onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                required
              />
            </Field>
            <Field label="Ende" htmlFor="appointment-end">
              <input
                id="appointment-end"
                type="time"
                value={form.endTime}
                onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Ort" htmlFor="appointment-location">
            <input
              id="appointment-location"
              value={form.location}
              onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
              placeholder="Büro, Telefon, online …"
            />
          </Field>
          <Field label="Kontakt" htmlFor="appointment-contact">
            <select
              id="appointment-contact"
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
          <Field label="Status" htmlFor="appointment-status">
            <select
              id="appointment-status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="scheduled">Geplant</option>
              <option value="completed">Abgeschlossen</option>
              <option value="cancelled">Abgesagt</option>
            </select>
          </Field>
          <Field label="Beschreibung" htmlFor="appointment-description" className="form-grid-full">
            <textarea
              id="appointment-description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Agenda oder Notizen (optional)"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Termin löschen?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteAppointment} disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Löschen
            </button>
          </>
        }
      >
        <p>„{deleteTarget?.title}“ wird dauerhaft gelöscht.</p>
      </Modal>
    </div>
  );
}
