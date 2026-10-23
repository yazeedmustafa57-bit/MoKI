import { Router } from 'express';
import { publicUser } from '../auth.js';
import {
  getAssistantStatus,
  getIntegrationStatus,
  getTelephonyStatus,
} from '../integrations/status.js';
import { appointmentOut, callOut, taskOut } from '../utils.js';

export function dashboardRouter({ db, config }) {
  const router = Router();

  router.get('/', (req, res) => {
    const userId = req.user.id;
    const now = new Date().toISOString();
    const count = (sql, ...params) => Number(db.prepare(sql).get(...params).count);

    const counts = {
      contacts: count('SELECT COUNT(*) AS count FROM contacts WHERE user_id = ?', userId),
      openTasks: count(
        "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status != 'done'",
        userId,
      ),
      doneTasks: count(
        "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'done'",
        userId,
      ),
      upcomingAppointments: count(
        "SELECT COUNT(*) AS count FROM appointments WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ?",
        userId,
        now,
      ),
      calls: count('SELECT COUNT(*) AS count FROM calls WHERE user_id = ?', userId),
      transcripts: count('SELECT COUNT(*) AS count FROM transcripts WHERE user_id = ?', userId),
    };

    const recentCalls = db
      .prepare(
        `SELECT c.*, TRIM(ct.first_name || ' ' || ct.last_name) AS contact_name
         FROM calls c LEFT JOIN contacts ct ON ct.id = c.contact_id
         WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 5`,
      )
      .all(userId)
      .map(callOut);

    const openTasks = db
      .prepare(
        `SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
         WHERE t.user_id = ? AND t.status != 'done'
         ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.created_at DESC
         LIMIT 5`,
      )
      .all(userId)
      .map(taskOut);

    const upcomingAppointments = db
      .prepare(
        `SELECT a.*, TRIM(c.first_name || ' ' || c.last_name) AS contact_name
         FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id
         WHERE a.user_id = ? AND a.status = 'scheduled' AND a.starts_at >= ?
         ORDER BY a.starts_at ASC LIMIT 5`,
      )
      .all(userId, now)
      .map(appointmentOut);

    const latestTranscripts = db
      .prepare(
        `SELECT id, title, summary, duration_seconds, created_at FROM transcripts
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`,
      )
      .all(userId)
      .map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
      }));

    const integrations = getIntegrationStatus(db, config);

    res.json({
      generatedAt: now,
      user: publicUser(req.user),
      assistant: getAssistantStatus(db, config),
      telephony: getTelephonyStatus(db, config),
      integrations: integrations.list,
      counts,
      recentCalls,
      openTasks,
      upcomingAppointments,
      latestTranscripts,
    });
  });

  return router;
}
