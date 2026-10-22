import { useState } from 'react';
import {
  LoaderCircle,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import {
  Avatar,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
} from '../components/ui.jsx';

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  notes: '',
  favorite: false,
};

export default function Contacts() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const contactsApi = useApi(
    `/contacts${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`,
  );
  const { toast } = useToast();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const contacts = contactsApi.data?.contacts || [];

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setModal({ type: 'edit', contact: null });
  };

  const openEdit = (contact) => {
    setForm({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      notes: contact.notes,
      favorite: contact.favorite,
    });
    setFormError(null);
    setModal({ type: 'edit', contact });
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
    setFormError(null);
  };

  const saveContact = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (modal?.contact) {
        await api(`/contacts/${modal.contact.id}`, { method: 'PATCH', body: form });
        toast('Kontakt aktualisiert.');
      } else {
        await api('/contacts', { method: 'POST', body: form });
        toast('Kontakt angelegt.');
      }
      setModal(null);
      contactsApi.reload();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFavorite = async (contact) => {
    setBusyId(contact.id);
    try {
      await api(`/contacts/${contact.id}`, {
        method: 'PATCH',
        body: { favorite: !contact.favorite },
      });
      contactsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteContact = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await api(`/contacts/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Kontakt gelöscht.');
      setDeleteTarget(null);
      contactsApi.reload();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Kontakte"
        description="Menschen, Nummern und Notizen an einem Ort – verknüpfbar mit Anrufen, Aufgaben und Terminen."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={17} /> Neuer Kontakt
          </button>
        }
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Kontakte durchsuchen</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, Firma, Nummer oder E-Mail suchen …"
          />
        </label>
        <span className="toolbar-count">
          {contacts.length} {contacts.length === 1 ? 'Kontakt' : 'Kontakte'}
        </span>
      </div>

      {contactsApi.loading && !contactsApi.data ? <LoadingState label="Kontakte werden geladen …" /> : null}
      {contactsApi.error && !contactsApi.data ? (
        <ErrorState error={contactsApi.error} onRetry={contactsApi.reload} />
      ) : null}

      {contactsApi.data && contacts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title={debouncedSearch ? 'Kein Kontakt gefunden' : 'Noch keine Kontakte'}
            description={
              debouncedSearch
                ? 'Passe die Suche an oder lege einen neuen Kontakt an.'
                : 'Lege deinen ersten Kontakt an – danach kannst du ihn direkt mit Anrufen verknüpfen.'
            }
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <Plus size={16} /> Kontakt anlegen
              </button>
            }
          />
        </div>
      ) : null}

      {contacts.length > 0 ? (
        <div className="card table-card">
          <div className="table-head contacts-grid">
            <span>Name</span>
            <span>Unternehmen</span>
            <span>Kontakt</span>
            <span aria-hidden="true" />
          </div>
          <ul className="data-list">
            {contacts.map((contact) => (
              <li key={contact.id} className="data-row contacts-grid">
                <div className="cell-main">
                  <Avatar name={`${contact.firstName} ${contact.lastName}`} color="#334155" size="sm" />
                  <div>
                    <strong>
                      {contact.firstName} {contact.lastName}
                      {contact.favorite ? (
                        <Star size={13} className="favorite-star" aria-label="Favorit" fill="currentColor" />
                      ) : null}
                    </strong>
                    <small>{contact.notes || 'Keine Notizen'}</small>
                  </div>
                </div>
                <span className="cell-muted">{contact.company || '–'}</span>
                <div className="contact-lines">
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="inline-link">
                      <Phone size={14} /> {contact.phone}
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="inline-link">
                      <Mail size={14} /> {contact.email}
                    </a>
                  ) : null}
                  {!contact.phone && !contact.email ? <span className="cell-muted">–</span> : null}
                </div>
                <div className="cell-actions">
                  <button
                    type="button"
                    className={`icon-btn ${contact.favorite ? 'favorite' : ''}`}
                    onClick={() => toggleFavorite(contact)}
                    disabled={busyId === contact.id}
                    aria-label={contact.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                  >
                    {busyId === contact.id ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Star size={16} fill={contact.favorite ? 'currentColor' : 'none'} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => openEdit(contact)}
                    aria-label="Kontakt bearbeiten"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => setDeleteTarget(contact)}
                    aria-label="Kontakt löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={modal?.type === 'edit'}
        onClose={closeModal}
        title={modal?.contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
        description="Nur Name und Kontaktdaten werden gespeichert."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={submitting}>
              Abbrechen
            </button>
            <button type="submit" form="contact-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : null}
              Speichern
            </button>
          </>
        }
      >
        <form id="contact-form" className="form-grid" onSubmit={saveContact}>
          {formError ? <div className="form-error form-grid-full">{formError}</div> : null}
          <Field label="Vorname" htmlFor="contact-first">
            <input
              id="contact-first"
              value={form.firstName}
              onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
              data-autofocus
              required
            />
          </Field>
          <Field label="Nachname" htmlFor="contact-last">
            <input
              id="contact-last"
              value={form.lastName}
              onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
            />
          </Field>
          <Field label="Unternehmen" htmlFor="contact-company">
            <input
              id="contact-company"
              value={form.company}
              onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
            />
          </Field>
          <Field label="Telefon" htmlFor="contact-phone">
            <input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+49 …"
            />
          </Field>
          <Field label="E-Mail" htmlFor="contact-email" className="form-grid-full">
            <input
              id="contact-email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@beispiel.de"
            />
          </Field>
          <Field label="Notizen" htmlFor="contact-notes" className="form-grid-full">
            <textarea
              id="contact-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Kontext, Vorlieben, letzter Stand …"
            />
          </Field>
          <label className="checkbox-row form-grid-full">
            <input
              type="checkbox"
              checked={form.favorite}
              onChange={(event) => setForm((current) => ({ ...current, favorite: event.target.checked }))}
            />
            <span>Als Favorit markieren</span>
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Kontakt löschen?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn-danger" onClick={deleteContact} disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Löschen
            </button>
          </>
        }
      >
        <p>
          {deleteTarget?.firstName} {deleteTarget?.lastName} wird dauerhaft entfernt. Verknüpfte
          Aufgaben und Termine bleiben erhalten, verlieren aber die Kontaktzuordnung.
        </p>
      </Modal>
    </div>
  );
}
