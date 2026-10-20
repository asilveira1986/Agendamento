import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createScheduler } from '../src/scheduler.js';

// 2030-01-07 é uma segunda-feira (weekday 1).
const DAY = '2030-01-07';

function setup() {
  const s = createScheduler(openDb(), { now: () => '2030-01-01T08:00' });
  const service = s.createService({ name: 'Corte', durationMin: 30, priceCents: 5000 });
  const pro = s.createProfessional({ name: 'Ana' });
  s.setHours(pro.id, [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '14:00', end: '15:00' },
  ]);
  return { s, service, pro };
}
const client = { clientName: 'João', clientPhone: '11999990000' };

test('disponibilidade respeita expediente e duração', () => {
  const { s, service, pro } = setup();
  const slots = s.availability({ professionalId: pro.id, serviceId: service.id, date: DAY });
  assert.equal(slots[0], '09:00');
  assert.ok(slots.includes('11:30'));
  assert.ok(!slots.includes('11:45'), 'não cabe 30 min antes do fim');
  assert.ok(!slots.includes('12:00'));
  assert.ok(slots.includes('14:30') && !slots.includes('14:45'));
  assert.deepEqual(s.availability({ professionalId: pro.id, serviceId: service.id, date: '2030-01-08' }), []);
});

test('agendar remove horários sobrepostos da disponibilidade', () => {
  const { s, service, pro } = setup();
  const a = s.book({ professionalId: pro.id, serviceId: service.id, startAt: `${DAY}T09:30`, ...client });
  assert.equal(a.end_at, `${DAY}T10:00`);
  const slots = s.availability({ professionalId: pro.id, serviceId: service.id, date: DAY });
  for (const t of ['09:15', '09:30', '09:45']) assert.ok(!slots.includes(t), t);
  assert.ok(slots.includes('09:00') && slots.includes('10:00'));
});

test('rejeita conflito, fora do expediente e passado', () => {
  const { s, service, pro } = setup();
  const base = { professionalId: pro.id, serviceId: service.id, ...client };
  s.book({ ...base, startAt: `${DAY}T10:00` });
  assert.throws(() => s.book({ ...base, startAt: `${DAY}T10:15` }), { status: 409 });
  assert.throws(() => s.book({ ...base, startAt: `${DAY}T12:00` }), { status: 409 });
  assert.throws(() => s.book({ ...base, startAt: `${DAY}T11:45` }), { status: 409 });
  assert.throws(() => s.book({ ...base, startAt: '2029-12-31T10:00' }), { status: 400 });
});

test('cancelar libera o horário', () => {
  const { s, service, pro } = setup();
  const base = { professionalId: pro.id, serviceId: service.id, ...client, startAt: `${DAY}T10:00` };
  const a = s.book(base);
  assert.equal(s.cancel(a.id).status, 'cancelled');
  assert.throws(() => s.cancel(a.id), { status: 409 });
  assert.doesNotThrow(() => s.book(base));
  assert.equal(s.listAppointments({ date: DAY }).length, 2);
});

test('validações de entrada', () => {
  const { s, service, pro } = setup();
  assert.throws(() => s.createService({ name: '', durationMin: 30 }), { status: 400 });
  assert.throws(() => s.createService({ name: 'X', durationMin: 0 }), { status: 400 });
  assert.throws(() => s.setHours(pro.id, [{ weekday: 1, start: '10:00', end: '09:00' }]), { status: 400 });
  assert.throws(() => s.setHours(pro.id, [
    { weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:00', end: '12:00' },
  ]), { status: 400 });
  assert.throws(() => s.book({ professionalId: pro.id, serviceId: service.id, startAt: 'x', ...client }), { status: 400 });
  assert.throws(() => s.book({ professionalId: 99, serviceId: service.id, startAt: `${DAY}T10:00`, ...client }), { status: 404 });
});
