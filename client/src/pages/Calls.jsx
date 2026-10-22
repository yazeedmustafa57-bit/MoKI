import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  LoaderCircle,
  Phone,
  PhoneCall,
  Plus,
  ShieldAlert,
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
import { formatDateTime, formatDuration } from '../utils/format.js';

const emptyForm = { contactId: '', phone: '', direction: 'outbound', notes: '' };

export default function Calls() {
  const callsApi = useApi('/calls');
  const contactsApi = useApi('/contacts');
  const integrationsApi = useApi('/integrations');
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [startError, setStartError] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState('');
  const [completeNotes, setCompleteNotes] = useState('');

  const contacts = contactsApi.data?.contacts || [];
  const calls = callsApi.data?.calls || [];
  const telephony = integrationsApi.data?.integrations?.find((item) => item.provider === 'zadarma');
  const canStart = Boolean(telephony?.configured && telephony?.liveCallsEnabled);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === form.contactId) || null,
    [contacts, form.contactId],
  );

  const openPrepare = () => {
    setForm(emptyForm);
    setFormError(null);
    setModal({ type: 'prepare' });
  };

  const openStart = (call) => {
    setConfirmChecked(false);
    setStartError(null);
    setModal({ type: 'start', call });
  };

  const openComplete = (call) => {
    setDurationMinutes(call.durationSeconds ? String(Math.round(call.durationSeconds / 60)) : '');
    setCompleteNotes(call.notes || '');
    setFormError(null);
    setModal({ type: 'complete', call });
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setFormError(null);
    setStartError(null);
  };

  const updateContact = (contactId) => {
    const contact = contacts.find((item) => item.id === contactId);
    setForm((current) => ({
      ...current,
      contactId,
      phone: contact?.phone || current.phone,
    }));
  };

  const prepareCall = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api('/calls', {
        method: 'POST',
        body: {
          contactId: form.contactId || null,
          phone: form.phone,
          direction: form.direction,
          notes: form.notes,
        },
      });
      setModal(null);
      toast('Anruf vorbereitet. Es wurde noch kein Anruf ausgelöst.');
      callsApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startCall = async () => {
    if (!modal?.call || !confirmChecked) return;
    setSubmitting(true);
    setStartError(null);
    try {
      const result = await api(`/calls/${modal.call.id}/start`, {
        method: 'POST',
        body: { confirm: true },
      });
      setModal(null);
      toast(result.notice || 'Anruf angefordert.');
      callsApi.reload();
    } catch (requestError) {
      setStartError(requestError.message);
      callsApi.reload();
    } finally {
      setSubmitting(false);
    }
  };

  const completeCall = async (event) => {
    event.preventDefault();
    if (!modal?.call) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const minutes = Number.parseFloat(durationMinutes);
      const durationSeconds = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes * 60)) : 0;
      await api(`/calls/${modal.call.id}`, {
        method: 'PATCH',
        body: { status: 'completed', durationSeconds, notes: completeNotes },
      });
      setModal(null);
      toast('Anruf als abgeschlossen protokolliert.');
      callsApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const loading = callsApi.loading && !callsApi.data;

  return (
    <div className="page-stack">
      <PageHeader
        title="Anrufe"
        description="Anrufe werden vorbereitet und erst nach ausdrücklicher Bestätigung gestartet."
        actions={
          <button type="button" className="btn btn-primary" onClick={openPrepare}>
            <Plus size={17} /> Anruf vorbereiten
          </button>
        }
      />

      {telephony && !canStart ? (
        <div className="notice notice-warning">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>Anrufe sind gesperrt</strong>
            <p>{telephony.message}</p>
          </div>
          <Link to="/integrations" className="btn btn-secondary btn-sm">
            Integrationen
          </Link>
        </div>
      ) : null}

      {telephony && canStart ? (
        <div className="notice notice-info">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Live-Anrufe sind freigeschaltet</strong>
            <p>
              Nach der Bestätigung wird ein echter Anruf über Zadarma angefordert. Der
              Gesprächsstatus kann nicht automatisch verifiziert werden.
            </p>
          </div>
        </div>
      ) : null}

      {loading ? <LoadingState label="Anrufliste wird geladen …" /> : null}
      {callsApi.error && !callsApi.data ? (
        <ErrorState error={callsApi.error} onRetry={callsApi.reload} />
      ) : null}

      {callsApi.data && calls.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={PhoneCall}
            title="Noch keine Anrufe"
            description="Bereite deinen ersten Anruf vor. Gespeichert wird er sofort, ausgelöst erst nach deiner Bestätigung."
            action={
              <button type="button" className="btn btn-primary" onClick={openPrepare}>
                <Plus size={16} /> Anruf vorbereiten
              </button>
            }
          />
        </div>
      ) : null}

      {calls.length > 0 ? (
        <div className="card table-card">
          <div className="table-head calls-grid">
            <span>Kontakt</span>
            <span>Nummer</span>
            <span>Zeitpunkt</span>
            <span>Dauer</span>
            <span>Status</span>
            <span aria-hidden="true" />
          </div>
          <ul className="data-list">
            {calls.map((call) => (
              <li key={call.id} className="data-row calls-grid">
                <div className="cell-main">
                  <span className={`direction-icon ${call.direction}`}>
                    {call.direction === 'inbound' ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{call.contactName || (call.direction === 'inbound' ? 'Eingehend' : 'Ausgehend')}</strong>
                    <small>{call.notes || (call.direction === 'inbound' ? 'Eingehender Anruf' : 'Ausgehender Anruf')}</small>
                  </div>
                </div>
                <span className="mono cell-phone">{call.phone || '–'}</span>
                <span className="cell-muted cell-time">{formatDateTime(call.createdAt)}</span>
                <span className="cell-muted cell-duration">{formatDuration(call.durationSeconds)}</span>
                <div className="cell-status">
                  <StatusBadge status={call.status} type="call" />
                  {call.errorMessage ? <small className="cell-error">{call.errorMessage}</small> : null}
                </div>
                <div className="cell-actions">
                  {call.status === 'prepared' ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => openStart(call)}
                      disabled={!canStart}
                      title={!canStart ? 'Anrufe sind nicht freigeschaltet.' : 'Anruf starten'}
                    >
                      <Phone size={14} /> Anrufen
                    </button>
                  ) : null}
                  {['prepared', 'dialing'].includes(call.status) ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openComplete(call)}
                    >
                      <CalendarClock size={14} /> Erledigt
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={modal?.type === 'prepare'}
        onClose={closeModal}
        title="Anruf vorbereiten"
        description="Es wird noch kein Anruf ausgelöst. Der Eintrag wird nur gespeichert."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="prepare-call-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
              Vorbereiten
            </button>
          </>
        }
      >
        <form id="prepare-call-form" className="form-grid" onSubmit={prepareCall}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Kontakt (optional)" htmlFor="call-contact" className="form-grid-full">
            <select
              id="call-contact"
              value={form.contactId}
              onChange={(event) => updateContact(event.target.value)}
            >
              <option value="">Ohne Kontaktzuordnung</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                  {contact.phone ? ` · ${contact.phone}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Telefonnummer" htmlFor="call-phone" className="form-grid-full">
            <input
              id="call-phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+49 …"
              required
            />
          </Field>
          {selectedContact && !selectedContact.phone ? (
            <p className="field-hint form-grid-full">
              Für diesen Kontakt ist keine Nummer hinterlegt. Bitte trage sie hier ein.
            </p>
          ) : null}
          <Field label="Richtung" htmlFor="call-direction">
            <select
              id="call-direction"
              value={form.direction}
              onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value }))}
            >
              <option value="outbound">Ausgehend</option>
              <option value="inbound">Eingehend</option>
            </select>
          </Field>
          <Field label="Notiz" htmlFor="call-notes" className="form-grid-full">
            <textarea
              id="call-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Worum geht es?"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={modal?.type === 'start'}
        onClose={closeModal}
        title="Echten Anruf starten?"
        description="Diese Aktion fordert einen echten Anruf bei Zadarma an."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={startCall}
              disabled={!confirmChecked || submitting}
            >
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Phone size={16} />}
              Anruf jetzt starten
            </button>
          </>
        }
      >
        <div className="confirm-box">
          <span className="confirm-icon">
            <PhoneCall size={22} />
          </span>
          <div>
            <strong>{modal?.call?.contactName || 'Unbekannter Kontakt'}</strong>
            <p className="mono">{modal?.call?.phone}</p>
          </div>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(event) => setConfirmChecked(event.target.checked)}
          />
          <span>Ich habe die Nummer geprüft und möchte den Anruf auslösen.</span>
        </label>
        {startError ? (
          <div className="form-error" role="alert">
            {startError}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={modal?.type === 'complete'}
        onClose={closeModal}
        title="Anruf protokollieren"
        description="Trage das Ergebnis manuell ein. Es wird kein Anruf ausgelöst."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="complete-call-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : null}
              Speichern
            </button>
          </>
        }
      >
        <form id="complete-call-form" className="form-grid" onSubmit={completeCall}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Dauer in Minuten" htmlFor="call-duration">
            <input
              id="call-duration"
              type="number"
              min="0"
              step="0.5"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              placeholder="z. B. 4,5"
            />
          </Field>
          <Field label="Notiz" htmlFor="complete-notes" className="form-grid-full">
            <textarea
              id="complete-notes"
              rows={4}
              value={completeNotes}
              onChange={(event) => setCompleteNotes(event.target.value)}
              placeholder="Ergebnis des Gesprächs"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
