import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';

test('fluxo completo via HTTP', async () => {
  const server = http.createServer(createApp(openDb(), { now: () => '2030-01-01T08:00' }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const svc = (await call('POST', '/api/services', { name: 'Massagem', durationMin: 60 })).body;
    const pro = (await call('POST', '/api/professionals', { name: 'Bia' })).body;
    assert.equal((await call('PUT', `/api/professionals/${pro.id}/hours`, { hours: [{ weekday: 1, start: '09:00', end: '11:00' }] })).status, 200);

    const q = `professionalId=${pro.id}&serviceId=${svc.id}&date=2030-01-07`;
    assert.deepEqual((await call('GET', '/api/availability?' + q)).body.slice(0, 2), ['09:00', '09:15']);

    const appt = { professionalId: pro.id, serviceId: svc.id, startAt: '2030-01-07T09:00', clientName: 'Maria', clientPhone: '1' };
    const created = await call('POST', '/api/appointments', appt);
    assert.equal(created.status, 201);
    assert.equal((await call('POST', '/api/appointments', appt)).status, 409);

    assert.equal((await call('GET', '/api/appointments?date=2030-01-07')).body.length, 1);
    assert.equal((await call('DELETE', `/api/appointments/${created.body.id}`)).body.status, 'cancelled');
    assert.equal((await call('GET', '/api/nada')).status, 404);
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    server.close();
  }
});
