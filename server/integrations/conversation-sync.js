import crypto from 'node:crypto';
import { nowIso, transaction } from '../db.js';

const CONVERSATION_STATUSES = new Set([
  'initiated',
  'in-progress',
  'processing',
  'done',
  'failed',
]);

const RESULT_BY_PROVIDER = {
  success: 'successful',
  failure: 'unsuccessful',
  unknown: 'unclear',
};

function cleanText(value, maxLength = 10000) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function unixSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addSeconds(value, seconds) {
  if (!value || seconds <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function conversationResult(status, analysis) {
  if (status === 'failed') return 'failed';
  const providerResult = RESULT_BY_PROVIDER[analysis?.call_successful];
  if (providerResult) return providerResult;
  if (status === 'done') return 'unclear';
  return 'pending';
}

function transcriptStatus(status, segmentCount, hasStoredTranscript) {
  if (segmentCount > 0 || hasStoredTranscript) return 'available';
  if (status === 'done' || status === 'failed') return 'unavailable';
  if (status === 'processing' || status === 'in-progress') return 'processing';
  return 'pending';
}

export function normalizeConversation(body) {
  const status = CONVERSATION_STATUSES.has(body?.status) ? body.status : '';
  const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const analysis = body?.analysis && typeof body.analysis === 'object' ? body.analysis : null;
  const durationSeconds = nonNegativeInteger(metadata.call_duration_secs);
  const startedAt = unixSecondsToIso(metadata.start_time_unix_secs);

  const segments = (Array.isArray(body?.transcript) ? body.transcript : [])
    .slice(0, 2000)
    .map((entry, index) => {
      const message = cleanText(entry?.message ?? entry?.original_message, 20000);
      if (!message) return null;
      return {
        id: typeof entry?.id === 'string' && entry.id ? entry.id : `segment-${index + 1}`,
        role: entry?.role === 'agent' ? 'agent' : 'user',
        message,
        timeInCallSecs: nonNegativeInteger(entry?.time_in_call_secs),
        interrupted: Boolean(entry?.interrupted),
      };
    })
    .filter(Boolean);

  const content = segments
    .map(
      (segment) =>
        `${segment.role === 'agent' ? 'Victor' : 'Gesprächspartner'}: ${segment.message}`,
    )
    .join('\n');

  return {
    conversationId: cleanText(body?.conversation_id, 200),
    status,
    result: conversationResult(status, analysis),
    summary: cleanText(analysis?.transcript_summary, 4000),
    durationSeconds,
    startedAt,
    endedAt: addSeconds(startedAt, durationSeconds),
    terminationReason: cleanText(metadata.termination_reason, 500),
    segments,
    content,
    language: cleanText(metadata.main_language, 40),
  };
}

export function saveConversation(db, { userId, call, conversation }) {
  const timestamp = nowIso();
  return transaction(db, () => {
    const existingTranscript = db
      .prepare(
        `SELECT id FROM transcripts
         WHERE user_id = ? AND call_id = ? AND source = 'elevenlabs'
         LIMIT 1`,
      )
      .get(userId, call.id);
    const segments = conversation.segments;
    const status = transcriptStatus(
      conversation.status,
      segments.length,
      Boolean(existingTranscript),
    );

    const localStatus =
      call.status === 'dialing' && conversation.status === 'done'
        ? 'completed'
        : call.status === 'dialing' && conversation.status === 'failed'
          ? 'failed'
          : call.status;
    const endedAt =
      localStatus === 'completed' || localStatus === 'failed'
        ? conversation.endedAt || call.ended_at || timestamp
        : call.ended_at;
    const errorCode =
      localStatus === 'failed' && call.status === 'dialing'
        ? 'PROVIDER_CONVERSATION_FAILED'
        : call.error_code;
    const errorMessage =
      localStatus === 'failed' && call.status === 'dialing'
        ? 'ElevenLabs meldet für dieses Gespräch einen Fehler.'
        : call.error_message;

    db.prepare(
      `UPDATE calls SET
         status = ?,
         conversation_status = ?,
         conversation_result = ?,
         result_summary = ?,
         transcript_status = ?,
         termination_reason = ?,
         provider_synced_at = ?,
         provider_updated_at = ?,
         started_at = COALESCE(?, started_at),
         ended_at = ?,
         duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
         error_code = ?,
         error_message = ?,
         updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      localStatus,
      conversation.status,
      conversation.result,
      conversation.summary,
      status,
      conversation.terminationReason,
      timestamp,
      timestamp,
      conversation.startedAt,
      endedAt,
      conversation.durationSeconds,
      conversation.durationSeconds,
      errorCode,
      errorMessage,
      timestamp,
      call.id,
      userId,
    );

    let transcript = null;
    if (segments.length > 0) {
      const values = [
        call.contact_name
          ? `Gespräch mit ${call.contact_name}`
          : 'Automatisch übertragenes Gespräch',
        conversation.content,
        conversation.summary,
        conversation.durationSeconds,
        JSON.stringify(segments),
        conversation.conversationId || call.provider_ref,
        conversation.language,
        timestamp,
      ];
      if (existingTranscript) {
        db.prepare(
          `UPDATE transcripts SET
             title = ?, content = ?, summary = ?, duration_seconds = ?,
             segments = ?, provider_ref = ?, language = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        ).run(...values, existingTranscript.id, userId);
        transcript = db
          .prepare('SELECT * FROM transcripts WHERE id = ?')
          .get(existingTranscript.id);
      } else {
        const id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO transcripts
             (id, user_id, call_id, title, content, summary, duration_seconds,
              source, segments, provider_ref, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'elevenlabs', ?, ?, ?, ?, ?)`,
        ).run(
          id,
          userId,
          call.id,
          ...values.slice(0, 7),
          timestamp,
          timestamp,
        );
        transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
      }
    } else {
      transcript = existingTranscript
        ? db.prepare('SELECT * FROM transcripts WHERE id = ?').get(existingTranscript.id)
        : null;
    }

    return { transcript };
  });
}
