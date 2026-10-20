import { HttpError } from './errors.js';
import {
  TIME_RE, DATETIME_RE, toMinutes, fromMinutes, isValidDate, weekdayOf, addMinutes, nowLocal,
} from './time.js';

const SLOT_STEP_MIN = 15;

export function createScheduler(db, { now = nowLocal } = {}) {
  const must = (row, msg) => {
    if (!row) throw new HttpError(404, msg);
    return row;
  };
  const nonEmpty = (v, field) => {
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} é obrigatório`);
    return v.trim();
  };

  // ---------- serviços ----------
  const listServices = () => db.prepare('SELECT * FROM services ORDER BY name').all();
  const getService = (id) => must(db.prepare('SELECT * FROM services WHERE id = ?').get(id), 'Serviço não encontrado');

  function createService({ name, durationMin, priceCents = 0 }) {
    nonEmpty(name, 'name');
    if (!Number.isInteger(durationMin) || durationMin <= 0) throw new HttpError(400, 'durationMin deve ser inteiro positivo');
    if (!Number.isInteger(priceCents) || priceCents < 0) throw new HttpError(400, 'priceCents inválido');
    const r = db.prepare('INSERT INTO services (name, duration_min, price_cents) VALUES (?, ?, ?)')
      .run(name.trim(), durationMin, priceCents);
    return getService(Number(r.lastInsertRowid));
  }

  // ---------- profissionais ----------
  const getProfessional = (id) => must(db.prepare('SELECT * FROM professionals WHERE id = ?').get(id), 'Profissional não encontrado');
  const hoursOf = (id) => db.prepare(
    'SELECT weekday, start_time, end_time FROM working_hours WHERE professional_id = ? ORDER BY weekday, start_time',
  ).all(id);
  const listProfessionals = () =>
    db.prepare('SELECT * FROM professionals ORDER BY name').all().map((p) => ({ ...p, hours: hoursOf(p.id) }));

  function createProfessional({ name }) {
    nonEmpty(name, 'name');
    const r = db.prepare('INSERT INTO professionals (name) VALUES (?)').run(name.trim());
    return { ...getProfessional(Number(r.lastInsertRowid)), hours: [] };
  }

  // hours: [{ weekday: 0-6 (0=domingo), start: 'HH:MM', end: 'HH:MM' }]
  function setHours(professionalId, hours) {
    getProfessional(professionalId);
    if (!Array.isArray(hours)) throw new HttpError(400, 'hours deve ser uma lista');
    for (const h of hours) {
      if (!Number.isInteger(h.weekday) || h.weekday < 0 || h.weekday > 6) throw new HttpError(400, 'weekday deve ser 0-6');
      if (!TIME_RE.test(h.start ?? '') || !TIME_RE.test(h.end ?? '')) throw new HttpError(400, 'start/end devem ser HH:MM');
      if (toMinutes(h.start) >= toMinutes(h.end)) throw new HttpError(400, 'start deve ser anterior a end');
    }
    const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < sorted.length; i++) {
      const [p, c] = [sorted[i - 1], sorted[i]];
      if (p.weekday === c.weekday && toMinutes(c.start) < toMinutes(p.end)) throw new HttpError(400, 'faixas de horário sobrepostas');
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM working_hours WHERE professional_id = ?').run(professionalId);
      const ins = db.prepare('INSERT INTO working_hours (professional_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
      for (const h of sorted) ins.run(professionalId, h.weekday, h.start, h.end);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return hoursOf(professionalId);
  }

  // ---------- disponibilidade ----------
  const overlapping = (professionalId, startAt, endAt) => db.prepare(
    `SELECT id FROM appointments
     WHERE professional_id = ? AND status = 'scheduled' AND start_at < ? AND end_at > ? LIMIT 1`,
  ).get(professionalId, endAt, startAt);

  function availability({ professionalId, serviceId, date }) {
    if (!isValidDate(date ?? '')) throw new HttpError(400, 'date deve ser YYYY-MM-DD');
    getProfessional(professionalId);
    const { duration_min } = getService(serviceId);
    const windows = db.prepare(
      'SELECT start_time, end_time FROM working_hours WHERE professional_id = ? AND weekday = ? ORDER BY start_time',
    ).all(professionalId, weekdayOf(date));
    const current = now();
    const slots = [];
    for (const w of windows) {
      for (let t = toMinutes(w.start_time); t + duration_min <= toMinutes(w.end_time); t += SLOT_STEP_MIN) {
        const startAt = `${date}T${fromMinutes(t)}`;
        if (startAt <= current) continue;
        if (overlapping(professionalId, startAt, addMinutes(startAt, duration_min))) continue;
        slots.push(fromMinutes(t));
      }
    }
    return slots;
  }

  // ---------- agendamentos ----------
  const getAppointment = (id) => must(db.prepare(
    `SELECT a.*, s.name AS service_name, p.name AS professional_name
     FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id
     WHERE a.id = ?`,
  ).get(id), 'Agendamento não encontrado');

  function listAppointments({ date, professionalId } = {}) {
    const where = [];
    const args = [];
    if (date) {
      if (!isValidDate(date)) throw new HttpError(400, 'date deve ser YYYY-MM-DD');
      where.push('a.start_at LIKE ?');
      args.push(`${date}%`);
    }
    if (professionalId) {
      where.push('a.professional_id = ?');
      args.push(professionalId);
    }
    return db.prepare(
      `SELECT a.*, s.name AS service_name, p.name AS professional_name
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.start_at`,
    ).all(...args);
  }

  function book({ professionalId, serviceId, startAt, clientName, clientPhone }) {
    nonEmpty(clientName, 'clientName');
    nonEmpty(clientPhone, 'clientPhone');
    if (!DATETIME_RE.test(startAt ?? '') || !isValidDate(startAt.slice(0, 10))) {
      throw new HttpError(400, 'startAt deve ser YYYY-MM-DDTHH:MM');
    }
    getProfessional(professionalId);
    const { duration_min } = getService(serviceId);
    if (startAt <= now()) throw new HttpError(400, 'Não é possível agendar no passado');

    const date = startAt.slice(0, 10);
    const startMin = toMinutes(startAt.slice(11));
    const endAt = addMinutes(startAt, duration_min);
    const inWindow = db.prepare(
      'SELECT start_time, end_time FROM working_hours WHERE professional_id = ? AND weekday = ?',
    ).all(professionalId, weekdayOf(date))
      .some((w) => startMin >= toMinutes(w.start_time) && startMin + duration_min <= toMinutes(w.end_time));
    if (!inWindow || endAt.slice(0, 10) !== date) throw new HttpError(409, 'Horário fora do expediente do profissional');

    // BEGIN IMMEDIATE evita corrida entre a checagem de conflito e o insert.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (overlapping(professionalId, startAt, endAt)) throw new HttpError(409, 'Horário já ocupado');
      const r = db.prepare(
        `INSERT INTO appointments (professional_id, service_id, client_name, client_phone, start_at, end_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(professionalId, serviceId, clientName.trim(), clientPhone.trim(), startAt, endAt);
      db.exec('COMMIT');
      return getAppointment(Number(r.lastInsertRowid));
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function cancel(id) {
    const appt = getAppointment(id);
    if (appt.status === 'cancelled') throw new HttpError(409, 'Agendamento já cancelado');
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
    return getAppointment(id);
  }

  return {
    listServices, createService, listProfessionals, createProfessional, setHours,
    availability, listAppointments, book, cancel,
  };
}
