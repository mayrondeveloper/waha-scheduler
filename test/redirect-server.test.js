// Servidor do redirecionador, em porta 0 com banco temporário. Pula sem node:sqlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sqlite = await import('node:sqlite').catch(() => null);
const skip = sqlite ? false : 'node:sqlite indisponível neste Node';
const { startRedirect } = sqlite ? await import('../src/redirect/server.js') : {};

const HUMAN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const INPUT = {
  dispatchId: 'dsp-1',
  schedule: { id: 'sch-a', name: 'Ofertas da manhã' },
  groups: [{ id: '1@g.us', name: 'Grupo Alpha' }, { id: '2@g.us', name: 'Grupo Beta' }],
  urls: ['https://loja.exemplo/p?tag=x'],
  utm: true,
};

async function boot(t) {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'waha-redirect-srv-')), 'clicks.sqlite');
  const started = await startRedirect({ port: 0, dbPath, publicUrl: 'https://go.exemplo' });
  t.after(() => started.close());
  const account = started.db.createAccount('Teste');
  const base = `http://127.0.0.1:${started.port}`;
  const call = (path, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.key}`, ...(init.headers ?? {}) },
  });
  const visit = (path, init = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
  const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));
  return { call, visit, settle, base, db: started.db, account };
}

test('cria links por grupo e URL, redireciona com 302 e conta só os cliques humanos', { skip }, async (t) => {
  const { call, visit, settle } = await boot(t);
  const res = await call('/api/links', { method: 'POST', body: JSON.stringify(INPUT) });
  assert.equal(res.status, 201);
  const { links } = await res.json();
  const shortA = links['1@g.us']['https://loja.exemplo/p?tag=x'];
  const shortB = links['2@g.us']['https://loja.exemplo/p?tag=x'];
  assert.match(shortA, /^https:\/\/go\.exemplo\/r\/[0-9A-Za-z]{10}$/);
  assert.notEqual(shortA, shortB);

  const pathA = new URL(shortA).pathname;
  const human = await visit(pathA, { headers: { 'User-Agent': HUMAN_UA, 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal(human.status, 302);
  const location = new URL(human.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://loja.exemplo/p');
  assert.equal(location.searchParams.get('utm_content'), 'grupo-alpha');
  assert.equal(human.headers.get('cache-control'), 'no-store');

  // Mesmo visitante de novo: conta o clique, não o único. Robô e HEAD não contam.
  await visit(pathA, { headers: { 'User-Agent': HUMAN_UA, 'X-Forwarded-For': '203.0.113.9' } });
  await visit(pathA, { headers: { 'User-Agent': 'WhatsApp/2.23.20.0', 'X-Forwarded-For': '203.0.113.9' } });
  await visit(pathA, { method: 'HEAD', headers: { 'User-Agent': HUMAN_UA, 'X-Forwarded-For': '203.0.113.10' } });
  await visit(pathA, { headers: { 'User-Agent': HUMAN_UA, 'X-Forwarded-For': '203.0.113.11' } });
  await settle();

  const clicks = await (await call('/api/dispatches/dsp-1/clicks')).json();
  // O grupo sem clique aparece com zero: a tela mostra todos os grupos do disparo.
  assert.deepEqual(clicks, { clicks: 3, unique: 2, groups: { '1@g.us': { clicks: 3, unique: 2 }, '2@g.us': { clicks: 0, unique: 0 } } });
});

test('o criador do link (mesmo endereço) nos primeiros 60 s é prévia, não clique', { skip }, async (t) => {
  const { call, visit, settle } = await boot(t);
  // O POST e o GET saem do mesmo endereço (o socket local), sem X-Forwarded-For.
  const { links } = await (await call('/api/links', { method: 'POST', body: JSON.stringify(INPUT) })).json();
  const path = new URL(links['1@g.us']['https://loja.exemplo/p?tag=x']).pathname;
  await visit(path, { headers: { 'User-Agent': HUMAN_UA } });
  await settle();
  assert.equal((await (await call('/api/dispatches/dsp-1/clicks')).json()).clicks, 0);
});

test('sem chave 401; código inexistente 404 neutro; corpo grande 413; URL sem http 400', { skip }, async (t) => {
  const { call, visit, base } = await boot(t);
  const noKey = await fetch(`${base}/api/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(INPUT) });
  assert.equal(noKey.status, 401);
  const wrongKey = await fetch(`${base}/api/dispatches/dsp-1/clicks`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrongKey.status, 401);

  const missing = await visit('/r/naoexiste1');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Link não encontrado.');

  const big = await call('/api/links', { method: 'POST', body: JSON.stringify({ ...INPUT, urls: ['https://x.exemplo/' + 'a'.repeat(300_000)] }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);

  const bad = await call('/api/links', { method: 'POST', body: JSON.stringify({ ...INPUT, urls: ['ftp://arquivo'] }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Só http e https/);
});

test('60 acessos por minuto por endereço; robots bloqueia /r/; healthz responde', { skip }, async (t) => {
  const { visit, base } = await boot(t);
  let last;
  for (let i = 0; i < 61; i++) {
    last = await visit('/r/qualquer001', { headers: { 'X-Forwarded-For': '198.51.100.7' } });
  }
  assert.equal(last.status, 429);
  const other = await visit('/r/qualquer001', { headers: { 'X-Forwarded-For': '198.51.100.8' } });
  assert.equal(other.status, 404, 'outro endereço não é afetado');

  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Disallow: \/r\//);
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
  assert.equal((await fetch(`${base}/api/nada`)).status, 404);
});
