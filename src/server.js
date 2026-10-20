import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { openDb } from './db.js';
import { createScheduler } from './scheduler.js';
import { HttpError } from './errors.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new HttpError(413, 'Corpo muito grande');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export function createApp(db, options) {
  const s = createScheduler(db, options);
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));

  async function route(req, url) {
    const m = req.method;
    const p = url.pathname;
    const q = url.searchParams;
    let match;

    if (p === '/api/services' && m === 'GET') return [200, s.listServices()];
    if (p === '/api/services' && m === 'POST') return [201, s.createService(await readJson(req))];
    if (p === '/api/professionals' && m === 'GET') return [200, s.listProfessionals()];
    if (p === '/api/professionals' && m === 'POST') return [201, s.createProfessional(await readJson(req))];
    if ((match = p.match(/^\/api\/professionals\/(\d+)\/hours$/)) && m === 'PUT') {
      const body = await readJson(req);
      return [200, s.setHours(Number(match[1]), body.hours)];
    }
    if (p === '/api/availability' && m === 'GET') {
      return [200, s.availability({ professionalId: num(q.get('professionalId')), serviceId: num(q.get('serviceId')), date: q.get('date') })];
    }
    if (p === '/api/appointments' && m === 'GET') {
      return [200, s.listAppointments({ date: q.get('date') ?? undefined, professionalId: num(q.get('professionalId')) })];
    }
    if (p === '/api/appointments' && m === 'POST') return [201, s.book(await readJson(req))];
    if ((match = p.match(/^\/api\/appointments\/(\d+)$/)) && m === 'DELETE') return [200, s.cancel(Number(match[1]))];
    if (p.startsWith('/api/')) throw new HttpError(404, 'Rota não encontrada');
    return null;
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const result = await route(req, url);
      if (result) {
        res.writeHead(result[0], { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(result[1]));
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido');
      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'Acesso negado');
      try {
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        return res.end(data);
      } catch {
        throw new HttpError(404, 'Não encontrado');
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'Erro interno' : e.message }));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_PATH ?? 'agendamento.db');
  const port = Number(process.env.PORT ?? 3000);
  http.createServer(createApp(db)).listen(port, () => console.log(`Agendamento em http://localhost:${port}`));
}
