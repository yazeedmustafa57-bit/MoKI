import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Bitte prüfe die eingegebenen Daten.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function maskSecret(value, visible = 4) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= visible + 2) return '••••••';
  return `${text.slice(0, 2)}••••${text.slice(-visible)}`;
}

export function maskPhone(value) {
  const text = String(value || '');
  if (!text) return '';
  const digits = text.replace(/[^\d+]/g, '');
  if (digits.length <= 5) return '••••';
  return `${'•'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
}

export const text = (max = 500) => z.string().trim().max(max, `Maximal ${max} Zeichen.`);
export const requiredText = (max = 200, label = 'Dieses Feld') =>
  z.string().trim().min(1, `${label} ist erforderlich.`).max(max, `Maximal ${max} Zeichen.`);
export const optionalEmail = z
  .union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse.')])
  .optional()
  .default('');
export const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) => value === '' || /^[+()\d\s./-]{3,40}$/.test(value),
    'Ungültige Telefonnummer.',
  )
  .optional()
  .default('');

export const isoDateTime = z
  .string()
  .trim()
  .refine((value) => value.length > 0 && !Number.isNaN(Date.parse(value)), 'Ungültiges Datum.')
  .transform((value) => new Date(value).toISOString());

export const optionalIsoDateTime = z
  .union([z.literal(''), z.null(), isoDateTime])
  .optional()
  .transform((value) => value || null);

export const dateOnly = z
  .union([
    z.literal(''),
    z.null(),
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss im Format JJJJ-MM-TT vorliegen.'),
  ])
  .optional()
  .transform((value) => value || null);

export function parseBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function contactOut(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    notes: row.notes,
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function taskOut(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    contactId: row.contact_id,
    contactName: row.contact_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function appointmentOut(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    contactId: row.contact_id,
    contactName: row.contact_name || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function callOut(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name || null,
    direction: row.direction,
    status: row.status,
    phone: row.phone,
    notes: row.notes,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    provider: row.provider,
    providerRef: row.provider_ref,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transcriptOut(row) {
  return {
    id: row.id,
    callId: row.call_id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
