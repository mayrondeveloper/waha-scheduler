// Redirecionador dos cliques: processo separado, público (por trás de um túnel
// ou proxy com HTTPS), com contas por chave. Cria links rastreáveis por
// (disparo, grupo, URL), redireciona com 302 e conta os cliques humanos.
// Exige Node 24 (node:sqlite).

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './db.js';
import { classifyAccess, visitorHash, ipHash } from './codes.js';
import { loadRedirectConfig } from './config.js';
import { info, error, success } from '../logger.js';

const MAX_BODY_BYTES = 262_144;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const RETENTION_MS = 180 * 86_400_000;
const PURGE_EVERY_MS = 86_400_000;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

// Endereço do cliente: pelo túnel/proxy quando ele informa, senão o socket.
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? '';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let total = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) {
        done = true;
        const err = new Error('Corpo da requisição grande demais.');
        err.status = 413;
        reject(err);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('JSON inválido no corpo da requisição.');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Valida o corpo de POST /api/links, devolvendo-o limpo.
function parseLinksBody(body) {
  if (!body || typeof body !== 'object') throw httpError(400, 'Corpo deve ser um objeto.');
  if (typeof body.dispatchId !== 'string' || !body.dispatchId.trim()) throw httpError(400, 'Campo "dispatchId" é obrigatório.');
  const schedule = body.schedule ?? {};
  if (typeof schedule !== 'object' || typeof schedule.name !== 'string' || !schedule.name.trim()) {
    throw httpError(400, 'Campo "schedule.name" é obrigatório.');
  }
  if (!Array.isArray(body.groups) || body.groups.length === 0) throw httpError(400, 'Campo "groups" deve ser uma lista com ao menos um grupo.');
  const groups = body.groups.map((g) => {
    if (!g || typeof g.id !== 'string' || !g.id.trim()) throw httpError(400, 'Cada grupo precisa de "id".');
    return { id: g.id.trim(), name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : g.id.trim() };
  });
  if (!Array.isArray(body.urls) || body.urls.length === 0) throw httpError(400, 'Campo "urls" deve ser uma lista com ao menos uma URL.');
  const urls = [...new Set(body.urls.map((u) => String(u).trim()))];
  for (const url of urls) {
    if (!isHttpUrl(url)) throw httpError(400, `URL inválida: "${url}". Só http e https são aceitos.`);
  }
  if (groups.length * urls.length > 1000) throw httpError(400, 'Muitos links num disparo só (máximo 1000).');
  return {
    dispatchId: body.dispatchId.trim(),
    schedule: { id: typeof schedule.id === 'string' ? schedule.id : null, name: schedule.name.trim() },
    groups,
    urls,
    utm: body.utm !== false,
  };
}

/**
 * Sobe o redirecionador.
 * @param {{port?: number, host?: string, dbPath: string, publicUrl: string, now?: () => number}} options
 * @returns {Promise<{server: import('node:http').Server, port: number, db: object, close: () => void}>}
 */
export function startRedirect({ port = 0, host = '127.0.0.1', dbPath, publicUrl, now = Date.now }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const rate = new Map();

  const today = () => new Date(now()).toISOString().slice(0, 10);

  function purge() {
    try {
      const removed = db.purgeClicksBefore(new Date(now() - RETENTION_MS).toISOString());
      if (removed > 0) info(`Retenção: ${removed} clique(s) com mais de 180 dias apagados; os totais ficam.`);
    } catch (err) {
      error(`Falha na retenção de cliques: ${err.message}`);
    }
  }

  // 60 acessos por minuto por endereço em /r/: o resto é robô ou abuso.
  function rateLimited(ip) {
    const nowMs = now();
    if (rate.size > 10_000) rate.clear();
    const entry = rate.get(ip);
    if (!entry || nowMs - entry.windowStart > RATE_WINDOW_MS) {
      rate.set(ip, { count: 1, windowStart: nowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT;
  }

  function account(req) {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const found = match ? db.accountByKey(match[1].trim()) : null;
    if (!found) throw httpError(401, 'Chave de conta ausente ou inválida.');
    return found;
  }

  // Registra o acesso depois de responder: o redirecionamento nunca espera o banco.
  function record(req, link) {
    setImmediate(() => {
      try {
        const salt = db.daySalt(today());
        const ip = clientIp(req);
        const ua = req.headers['user-agent'] ?? '';
        const kind = classifyAccess({ method: req.method, userAgent: ua, ipHash: ipHash(salt, ip), link, nowMs: now() });
        db.recordClick(link.code, { kind, visitorHash: visitorHash(salt, ip, ua), now: now() });
      } catch (err) {
        error(`Não foi possível registrar o acesso ao link ${link.code}: ${err.message}`);
      }
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    const redirect = /^\/r\/([0-9A-Za-z]{1,32})$/.exec(path);
    if (redirect && (req.method === 'GET' || req.method === 'HEAD')) {
      if (rateLimited(clientIp(req))) return sendText(res, 429, 'Muitos acessos. Tente de novo em um minuto.');
      const link = db.linkByCode(redirect[1]);
      if (!link) return sendText(res, 404, 'Link não encontrado.');
      res.writeHead(302, { Location: link.final_url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      record(req, link);
      return;
    }

    if (req.method === 'GET' && path === '/robots.txt') return sendText(res, 200, 'User-agent: *\nDisallow: /r/\n');
    if (req.method === 'GET' && path === '/healthz') return sendJson(res, 200, { ok: true });

    if (req.method === 'POST' && path === '/api/links') {
      const owner = account(req);
      const input = parseLinksBody(await readBody(req, MAX_BODY_BYTES));
      const creatorIpHash = ipHash(db.daySalt(today()), clientIp(req));
      const links = db.createLinks(owner.id, input, { publicUrl, creatorIpHash, now: now() });
      info(`Conta "${owner.name}": ${input.groups.length * input.urls.length} link(s) criados para o disparo ${input.dispatchId}.`);
      return sendJson(res, 201, { links });
    }

    const clicks = /^\/api\/dispatches\/([^/]+)\/clicks$/.exec(path);
    if (clicks && req.method === 'GET') {
      const owner = account(req);
      return sendJson(res, 200, db.clicksByDispatch(owner.id, decodeURIComponent(clicks[1])));
    }

    return path.startsWith('/api/') ? sendJson(res, 404, { error: 'Rota não encontrada.' }) : sendText(res, 404, 'Nada aqui.');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status ?? 500;
      if (status >= 500) error(`Erro ao processar ${req.method} ${req.url}: ${err.message}`);
      if (path(req).startsWith('/api/')) sendJson(res, status, { error: status >= 500 ? 'Erro interno do servidor.' : err.message });
      else sendText(res, status, status >= 500 ? 'Erro interno do servidor.' : err.message);
    });
  });
  const path = (req) => new URL(req.url, 'http://localhost').pathname;

  purge();
  const purger = setInterval(purge, PURGE_EVERY_MS);
  purger.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        db,
        close() {
          clearInterval(purger);
          server.close();
          db.close();
        },
      });
    });
  });
}

// Executado apenas quando este arquivo é o entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  let cfg;
  try {
    cfg = loadRedirectConfig();
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
  startRedirect(cfg)
    .then(({ port }) => {
      success(`Redirecionador no ar em http://127.0.0.1:${port}, links públicos em ${cfg.publicUrl}/r/…, banco em ${cfg.dbPath}.`);
    })
    .catch((err) => {
      error(`Não foi possível subir o redirecionador: ${err.message}`);
      process.exit(1);
    });
}
