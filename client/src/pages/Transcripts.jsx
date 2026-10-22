import { useState } from 'react';
import {
  Clock,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
} from '../components/ui.jsx';
import { formatDateTime, formatDuration } from '../utils/format.js';

const emptyForm = {
  title: '',
  summary: '',
  content: '',
  durationMinutes: '',
  callId: '',
};

export default function Transcripts() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const transcriptsApi = useApi(
    `/transcripts${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`,
  );
  const callsApi = useApi('/calls?limit=200');
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const transcripts = transcriptsApi.data?.transcripts || [];
  const calls = callsApi.data?.calls || [];
  const callMap = new Map(calls.map((call) => [call.id, call]));

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setModal({ type: 'edit', transcript: null });
  };

  const openEdit = (transcript) => {
    setForm({
      title: transcript.title,
      summary: transcript.summary,
      content: transcript.content,
      durationMinutes: transcript.durationSeconds
        ? String(Math.round((transcript.durationSeconds / 60) * 10) / 10)
        : '',
      callId: transcript.callId || '',
    });
    setFormError(null);
    setModal({ type: 'edit', transcript });
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setFormError(null);
  };

  const saveTranscript = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const minutes = Number.parseFloat(form.durationMinutes);
    const body = {
      title: form.title,
      summary: form.summary,
      content: form.content,
      durationSeconds: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes * 60)) : 0,
      callId: form.callId || null,
    };
    try {
      if (modal?.transcript) {
        await api(`/transcripts/${modal.transcript.id}`, { method: 'PATCH', body });
        toast('Transkript aktualisiert.');
      } else {
        await api('/transcripts', { method: 'POST', body });
        toast('Transkript gespeichert.');
      }
      setModal(null);
      transcriptsApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTranscript = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api(`/transcripts/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Transkript gelöscht.');
      setDeleteTarget(null);
      transcriptsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Transkripte"
        description="Gesprächsnotizen, Zusammenfassungen und Verknüpfungen zu Anrufen."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={17} /> Neues Transkript
          </button>
        }
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Transkripte durchsuchen</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Titel, Zusammenfassung oder Inhalt durchsuchen …"
          />
        </label>
        <span className="toolbar-count">
          {transcripts.length} {transcripts.length === 1 ? 'Transkript' : 'Transkripte'}
        </span>
      </div>

      {transcriptsApi.loading && !transcriptsApi.data ? (
        <LoadingState label="Transkripte werden geladen …" />
      ) : null}
      {transcriptsApi.error && !transcriptsApi.data ? (
        <ErrorState error={transcriptsApi.error} onRetry={transcriptsApi.reload} />
      ) : null}

      {transcriptsApi.data && transcripts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FileText}
            title={debouncedSearch ? 'Kein Transkript gefunden' : 'Noch keine Transkripte'}
            description={
              debouncedSearch
                ? 'Passe die Suche an oder lege ein neues Transkript an.'
                : 'Speichere Gesprächsnotizen, um später Details nachzulesen.'
            }
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={16} /> Transkript anlegen
              </button>
            }
          />
        </div>
      ) : null}

      {transcripts.length > 0 ? (
        <div className="transcript-grid">
          {transcripts.map((transcript) => {
            const call = transcript.callId ? callMap.get(transcript.callId) : null;
            return (
              <article key={transcript.id} className="card transcript-card">
                <div className="transcript-head">
                  <div>
                    <h3>{transcript.title}</h3>
                    <p>{formatDateTime(transcript.createdAt)}</p>
                  </div>
                  <div className="transcript-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => openEdit(transcript)}
                      aria-label="Transkript bearbeiten"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setDeleteTarget(transcript)}
                      aria-label="Transkript löschen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="transcript-badges">
                  <Badge tone="neutral">
                    <Clock size={13} /> {formatDuration(transcript.durationSeconds)}
                  </Badge>
                  {call ? (
                    <Badge tone="info">
                      {call.contactName || call.phone || 'Anruf'}
                    </Badge>
                  ) : null}
                </div>
                {transcript.summary ? <p className="transcript-summary">{transcript.summary}</p> : null}
                {transcript.content ? (
                  <details className="transcript-content">
                    <summary>Inhalt anzeigen</summary>
                    <p>{transcript.content}</p>
                  </details>
                ) : (
                  <p className="muted small">Kein Inhalt hinterlegt.</p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      <Modal
        open={modal?.type === 'edit'}
        onClose={closeModal}
        title={modal?.transcript ? 'Transkript bearbeiten' : 'Neues Transkript'}
        description="Transkripte werden nur nach dem Speichern dauerhaft abgelegt."
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="transcript-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : null}
              Speichern
            </button>
          </>
        }
      >
        <form id="transcript-form" className="form-grid" onSubmit={saveTranscript}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Titel" htmlFor="transcript-title" className="form-grid-full">
            <input
              id="transcript-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="z. B. Erstgespräch mit …"
              data-autofocus
              required
            />
          </Field>
          <Field label="Zusammenfassung" htmlFor="transcript-summary" className="form-grid-full">
            <textarea
              id="transcript-summary"
              rows={2}
              value={form.summary}
              onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
              placeholder="Die wichtigsten Punkte in einem Satz"
            />
          </Field>
          <Field label="Dauer in Minuten" htmlFor="transcript-duration">
            <input
              id="transcript-duration"
              type="number"
              min="0"
              step="0.5"
              value={form.durationMinutes}
              onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))}
              placeholder="z. B. 12"
            />
          </Field>
          <Field label="Verknüpfter Anruf" htmlFor="transcript-call">
            <select
              id="transcript-call"
              value={form.callId}
              onChange={(event) => setForm((current) => ({ ...current, callId: event.target.value }))}
            >
              <option value="">Kein Anruf</option>
              {calls.map((call) => (
                <option key={call.id} value={call.id}>
                  {call.contactName || call.phone || 'Anruf'} · {formatDateTime(call.createdAt)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inhalt" htmlFor="transcript-content" className="form-grid-full">
            <textarea
              id="transcript-content"
              rows={9}
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              placeholder="Gesprächsverlauf oder Notizen einfügen …"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Transkript löschen?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteTranscript} disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Löschen
            </button>
          </>
        }
      >
        <p>„{deleteTarget?.title}“ wird dauerhaft entfernt.</p>
      </Modal>
    </div>
  );
}
