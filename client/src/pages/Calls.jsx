import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  Eye,
  LoaderCircle,
  MessageSquareText,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import ConversationTranscript from '../components/ConversationTranscript.jsx';
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

const emptyForm = {
  contactId: '',
  phone: '',
  direction: 'outbound',
  brief: '',
  bookingAuthorized: false,
  sharePhone: false,
};

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
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [syncingId, setSyncingId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const contacts = contactsApi.data?.contacts || [];
  const calls = callsApi.data?.calls || [];
  const telephony = integrationsApi.data?.integrations?.find((item) => item.provider === 'elevenlabs');
  const canStart = Boolean(
    telephony?.configured && telephony?.liveCallsEnabled && !telephony?.previewMode,
  );
  const canSync = Boolean(telephony?.configured);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === form.contactId) || null,
    [contacts, form.contactId],
  );
  const activeCall = detail?.call || modal?.call || null;
  const activeTranscript = detail?.transcripts?.[0] || null;

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
    setDetail(null);
    setDetailError(null);
  };

  const loadDetail = async (callId) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await api(`/calls/${callId}`);
      setDetail(result);
    } catch (requestError) {
      setDetailError(requestError);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetails = (call) => {
    setDetail(null);
    setModal({ type: 'details', call });
    loadDetail(call.id);
  };

  const syncCall = async (call) => {
    setSyncingId(call.id);
    try {
      const result = await api(`/calls/${call.id}/sync`, { method: 'POST' });
      toast(
        result.transcript
          ? 'Gespräch und Transkript wurden aktualisiert.'
          : 'Gesprächsstatus wurde aktualisiert. Ein Transkript ist noch nicht verfügbar.',
      );
      callsApi.reload();
      if (modal?.type === 'details') await loadDetail(call.id);
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSyncingId('');
    }
  };

  const openDelete = (call) => {
    setModal(null);
    setDetail(null);
    setDeleteTarget(call);
  };

  const deleteCall = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api(`/calls/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Anruf und lokale Transkripte wurden gelöscht.');
      setDeleteTarget(null);
      callsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteAll = () => {
    setDeleteConfirmed(false);
    setDeleteAllOpen(true);
  };

  const deleteAllCalls = async () => {
    if (!deleteConfirmed) return;
    setSubmitting(true);
    try {
      const result = await api('/calls', {
        method: 'DELETE',
        body: { confirm: true },
      });
      toast(
        result.deletedCount === 1
          ? 'Die Anrufhistorie wurde gelöscht.'
          : `${result.deletedCount} Anrufe wurden aus der lokalen Historie gelöscht.`,
      );
      setDeleteAllOpen(false);
      setDeleteConfirmed(false);
      callsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
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
          brief: form.brief,
          bookingAuthorized: form.bookingAuthorized,
          sharePhone: form.sharePhone,
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
          <>
            {calls.length > 0 ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={openDeleteAll}>
                <Trash2 size={15} /> Historie löschen
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={openPrepare}>
              <Plus size={17} /> Anruf vorbereiten
            </button>
          </>
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
              Nach der Bestätigung wird ein echter KI-Anruf über ElevenLabs SIP-Outbound
              angefordert. Status und Transkript werden erst durch eine manuelle
              Synchronisierung aus der ElevenLabs-Historie übernommen.
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
                    <small>{call.brief || call.notes || (call.direction === 'inbound' ? 'Eingehender Anruf' : 'Ausgehender Anruf')}</small>
                    {call.brief && call.notes && call.notes !== call.brief ? (
                      <small>Ergebnis: {call.notes}</small>
                    ) : null}
                  </div>
                </div>
                <span className="mono cell-phone">{call.phone || '–'}</span>
                <span className="cell-muted cell-time">{formatDateTime(call.createdAt)}</span>
                <span className="cell-muted cell-duration">{formatDuration(call.durationSeconds)}</span>
                <div className="cell-status">
                  <StatusBadge status={call.status} type="call" />
                  {call.conversationStatus ? (
                    <StatusBadge status={call.conversationStatus} type="conversation" />
                  ) : null}
                  {call.conversationResult && call.conversationResult !== 'unknown' ? (
                    <StatusBadge status={call.conversationResult} type="result" />
                  ) : null}
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
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openDetails(call)}
                  >
                    <Eye size={14} /> Details
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={modal?.type === 'details'}
        onClose={closeModal}
        title={activeCall ? activeCall.contactName || 'Gesprächsdetails' : 'Gesprächsdetails'}
        description={
          activeCall ? `${formatDateTime(activeCall.createdAt)} · ${activeCall.phone || 'Keine Nummer'}` : ''
        }
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Schließen
            </button>
            {activeCall && activeCall.providerRef ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => syncCall(activeCall)}
                disabled={!canSync || syncingId === activeCall.id}
                title={
                  canSync
                    ? 'Status und Transkript bei ElevenLabs abrufen'
                    : 'ElevenLabs ist nicht konfiguriert.'
                }
              >
                {syncingId === activeCall.id ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Synchronisieren
              </button>
            ) : null}
            {activeCall ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => openDelete(activeCall)}
              >
                <Trash2 size={16} /> Löschen
              </button>
            ) : null}
          </>
        }
      >
        {detailLoading ? <LoadingState label="Gesprächsdetails werden geladen …" compact /> : null}
        {detailError ? (
          <ErrorState
            error={detailError}
            compact
            onRetry={() => activeCall && loadDetail(activeCall.id)}
          />
        ) : null}
        {activeCall ? (
          <div className="conversation-detail">
            <div className="conversation-status">
              <div>
                <small>Technischer Status</small>
                <StatusBadge status={activeCall.status} type="call" />
              </div>
              <div>
                <small>Anbieterstatus</small>
                {activeCall.conversationStatus ? (
                  <StatusBadge status={activeCall.conversationStatus} type="conversation" />
                ) : (
                  <span className="muted small">Nicht synchronisiert</span>
                )}
              </div>
              <div>
                <small>Gesprächsergebnis</small>
                <StatusBadge status={activeCall.conversationResult} type="result" />
              </div>
              <div>
                <small>Transkript</small>
                <StatusBadge status={activeCall.transcriptStatus} type="transcript" />
              </div>
            </div>

            <dl className="call-facts">
              <div>
                <dt>Datum</dt>
                <dd>{formatDateTime(activeCall.createdAt)}</dd>
              </div>
              <div>
                <dt>Dauer</dt>
                <dd>{formatDuration(activeCall.durationSeconds)}</dd>
              </div>
              <div>
                <dt>Richtung</dt>
                <dd>{activeCall.direction === 'inbound' ? 'Eingehend' : 'Ausgehend'}</dd>
              </div>
              <div>
                <dt>Zielnummer</dt>
                <dd className="mono">{activeCall.phone || '–'}</dd>
              </div>
            </dl>

            {activeCall.brief ? (
              <section className="conversation-section">
                <h3>Auftrag</h3>
                <p>{activeCall.brief}</p>
              </section>
            ) : null}

            {activeCall.resultSummary || activeTranscript?.summary ? (
              <section className="conversation-section">
                <h3>Zusammenfassung</h3>
                <p>{activeCall.resultSummary || activeTranscript.summary}</p>
              </section>
            ) : null}

            {activeCall.terminationReason ? (
              <section className="conversation-section">
                <h3>Beendigungsgrund</h3>
                <p>{activeCall.terminationReason}</p>
              </section>
            ) : null}

            {activeCall.notes && activeCall.notes !== activeCall.brief ? (
              <section className="conversation-section">
                <h3>Notiz</h3>
                <p>{activeCall.notes}</p>
              </section>
            ) : null}

            <section className="conversation-section">
              <h3>Transkript</h3>
              {activeTranscript?.segments?.length > 0 ? (
                <ConversationTranscript
                  segments={activeTranscript.segments}
                  contactName={activeCall.contactName || 'Gesprächspartner'}
                />
              ) : activeTranscript?.content ? (
                <p className="transcript-plain">{activeTranscript.content}</p>
              ) : (
                <div className="conversation-empty">
                  <MessageSquareText size={22} aria-hidden="true" />
                  <p>
                    {!activeCall.providerRef
                      ? 'Für diesen Anruf wurde noch keine ElevenLabs-Konversation hinterlegt.'
                      : activeCall.transcriptStatus === 'processing' ||
                          activeCall.transcriptStatus === 'pending'
                        ? 'Das Transkript wird von ElevenLabs noch verarbeitet. Versuche es später erneut.'
                        : activeCall.transcriptStatus === 'unavailable'
                          ? 'ElevenLabs stellt für dieses Gespräch kein Transkript bereit.'
                          : 'Noch kein Transkript geladen. Synchronisiere den Anruf mit ElevenLabs.'}
                  </p>
                  {!canSync && activeCall.providerRef ? (
                    <p className="field-hint">ElevenLabs ist aktuell nicht konfiguriert.</p>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Anruf löschen?"
        description="Die lokale Anrufhistorie und alle zugehörigen lokalen Transkripte werden dauerhaft entfernt."
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={submitting}
            >
              Abbrechen
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteCall} disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Endgültig löschen
            </button>
          </>
        }
      >
        <p>
          „{deleteTarget?.contactName || deleteTarget?.phone || 'Dieser Anruf'}“ wird aus der
          lokalen Historie entfernt.
        </p>
        <p className="field-hint">
          Beim Anbieter gespeicherte Gesprächsdaten werden dadurch nicht gelöscht.
        </p>
      </Modal>

      <Modal
        open={deleteAllOpen}
        onClose={() => {
          if (!submitting) setDeleteAllOpen(false);
        }}
        title="Gesamte Anrufhistorie löschen?"
        description="Alle lokalen Anrufe und zugehörigen Transkripte dieses Kontos werden dauerhaft entfernt."
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDeleteAllOpen(false)}
              disabled={submitting}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={deleteAllCalls}
              disabled={!deleteConfirmed || submitting}
            >
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Historie endgültig löschen
            </button>
          </>
        }
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={deleteConfirmed}
            onChange={(event) => setDeleteConfirmed(event.target.checked)}
          />
          <span>
            Ich verstehe, dass die lokale Anrufhistorie dauerhaft gelöscht wird. Daten beim
            Anbieter bleiben bestehen.
          </span>
        </label>
      </Modal>

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
          <Field
            label={form.direction === 'outbound' ? 'Auftrag / Gesprächsziel' : 'Notiz'}
            htmlFor="call-brief"
            className="form-grid-full"
          >
            <textarea
              id="call-brief"
              rows={5}
              value={form.brief}
              onChange={(event) => setForm((current) => ({ ...current, brief: event.target.value }))}
              placeholder={
                form.direction === 'outbound'
                  ? 'z. B. Ruf meinen Vorgesetzten an und sag ihm, dass ich diese Woche krankgeschrieben bin.'
                  : 'Worum ging es bei dem Anruf?'
              }
              required={form.direction === 'outbound'}
            />
            {form.direction === 'outbound' ? (
              <>
                <p className="field-hint">
                  Der Assistent erhält diesen Auftrag als Gesprächskontext. Profildaten werden nur
                  nach ausdrücklicher Freigabe weitergegeben.
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.bookingAuthorized}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        bookingAuthorized: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    Terminbuchung ausdrücklich freigegeben. Ohne diese Freigabe fragt Victor nur
                    nach Verfügbarkeit und bestätigt keinen Termin.
                  </span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.sharePhone}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, sharePhone: event.target.checked }))
                    }
                  />
                  <span>
                    Rückrufnummer für genau diesen Anruf freigeben. Ohne Freigabe nennt Victor
                    keine Telefonnummer, Adresse oder E-Mail-Adresse.
                  </span>
                </label>
              </>
            ) : null}
          </Field>
        </form>
      </Modal>

      <Modal
        open={modal?.type === 'start'}
        onClose={closeModal}
        title="Echten Anruf starten?"
        description="Diese Aktion fordert einen echten KI-Anruf über ElevenLabs SIP-Outbound an."
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
        {modal?.call?.brief ? (
          <div className="confirm-brief">
            <strong>Auftrag</strong>
            <p>{modal.call.brief}</p>
            <p className="field-hint">
              Terminbuchung: {modal.call.bookingAuthorized ? 'ausdrücklich freigegeben' : 'nicht freigegeben'} ·
              Rückrufnummer: {modal.call.sharePhone ? 'freigegeben' : 'nicht freigegeben'}
            </p>
          </div>
        ) : null}
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
