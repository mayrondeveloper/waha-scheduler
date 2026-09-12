// Cliques por disparo na tela: agrupamento por dispatchId, textos do
// histórico e do card, UTM no formulário, rota GET /api/clicks e o app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { groupDispatches, lastDispatchByName } from '../public/history.js';
import { historyView, clicksText } from '../public/history-view.js';
import { scheduleList, scheduleForm, formUtm } from '../public/schedules-view.js';
import { startUi } from '../src/ui/server.js';

const SP = 'America/Sao_Paulo';
const NOW = Date.parse('2026-09-12T12:00:00Z');
const at = (s) => new Date(Date.parse('2026-09-12T11:00:00Z') + s * 1000).toISOString();
const entry = (s, extra) => ({ ts: at(s), label: 'ofertas', chatId: '1@g.us', status: 'sent', message: 'x', ...extra });

test('groupDispatches agrupa por dispatchId quando existe, e pela regra antiga sem ele', () => {
  const logs = [
    entry(0, { dispatchId: 'dsp-1', tracking: 'ok', links: 1 }),
    entry(5, { dispatchId: 'dsp-1', tracking: 'ok', links: 1, chatId: '2@g.us' }),
    entry(10, { dispatchId: 'dsp-2', tracking: 'ok', links: 1 }), // mesmo rótulo, 10 s depois: outro disparo
    entry(100, { dispatchId: 'dsp-2', tracking: 'ok', links: 1, chatId: '2@g.us' }), // 90 s depois, mesmo id: mesmo disparo
    entry(300, {}), // linha antiga sem id
    entry(305, { chatId: '2@g.us' }),
  ].reverse();
  const dispatches = groupDispatches(logs);
  assert.deepEqual(dispatches.map((d) => [d.dispatchId, d.entries.length, d.tracking, d.links]), [
    [null, 2, null, null],
    ['dsp-2', 2, 'ok', 1],
    ['dsp-1', 2, 'ok', 1],
  ]);
});

test('clicksText por estado do disparo', () => {
  const clicks = { 'dsp-1': { clicks: 47, unique: 31, groups: {} }, 'dsp-2': null };
  assert.equal(clicksText({ dispatchId: 'dsp-1', tracking: 'ok', links: 1 }, clicks), '47 cliques (31 únicos)');
  assert.equal(clicksText({ dispatchId: 'dsp-2', tracking: 'ok', links: 1 }, clicks), 'cliques indisponíveis');
  assert.equal(clicksText({ dispatchId: 'dsp-3', tracking: 'ok', links: 1 }, clicks), 'cliques…');
  assert.equal(clicksText({ dispatchId: 'dsp-4', tracking: 'unavailable', links: 1 }, clicks), 'não medido');
  assert.equal(clicksText({ dispatchId: 'dsp-5', tracking: 'off', links: 1 }, clicks), 'cliques desligados');
  assert.equal(clicksText({ dispatchId: 'dsp-6', tracking: 'none', links: 0 }, clicks), 'sem link');
  assert.equal(clicksText({ dispatchId: null, tracking: null, links: null }, clicks), '');
  assert.equal(clicksText({ dispatchId: 'dsp-7', tracking: 'ok', links: 1 }, { 'dsp-7': { clicks: 1, unique: 1 } }), '1 clique (1 único)');
});

test('histórico e card mostram os cliques por disparo e por grupo', () => {
  const logs = [entry(0, { dispatchId: 'dsp-1', tracking: 'ok', links: 1 }), entry(5, { dispatchId: 'dsp-1', tracking: 'ok', links: 1, chatId: '2@g.us' })].reverse();
  const dispatches = groupDispatches(logs);
  const clicks = { 'dsp-1': { clicks: 47, unique: 31, groups: { '1@g.us': { clicks: 40, unique: 30 }, '2@g.us': { clicks: 7, unique: 1 } } } };
  const html = historyView({ dispatches, filter: { name: '', onlyFailed: false }, groupName: (id) => id, timeZone: SP, now: NOW, clicks });
  assert.match(html, /<span class="clicks">47 cliques \(31 únicos\)<\/span>/);
  assert.match(html, /1@g\.us · 40 cliques \(30 únicos\)/);
  assert.match(html, /2@g\.us · 7 cliques \(1 único\)/);

  const cards = scheduleList({
    schedules: [{ id: 'a', name: 'ofertas', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'], enabled: true }],
    messages: [{ id: 'm', name: 'Oi', text: 'x' }],
    lastDispatches: lastDispatchByName(dispatches), clicks, timeZone: SP, now: NOW,
  });
  assert.match(cards, /Último envio: <span class="clicks">47 cliques \(31 únicos\)<\/span>/);
  const noClicks = scheduleList({
    schedules: [{ id: 'a', name: 'ofertas', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'], enabled: true }],
    messages: [{ id: 'm', name: 'Oi', text: 'x' }], lastDispatches: lastDispatchByName(dispatches), clicks: {},
  });
  assert.doesNotMatch(noClicks, /Último envio:/);
});

test('a caixa de UTM vem ligada por padrão e desligada quando o agendamento diz utm false', () => {
  const on = scheduleForm({ schedule: { messageId: 'm', groups: [] }, messages: [{ id: 'm', name: 'Oi', text: 'x' }], groups: [] });
  assert.match(on, /name="utm" checked/);
  assert.equal(formUtm(fakeForm(on)), true);
  const off = scheduleForm({ schedule: { messageId: 'm', groups: [], utm: false }, messages: [{ id: 'm', name: 'Oi', text: 'x' }], groups: [] });
  assert.equal(formUtm(fakeForm(off)), false);
  assert.equal(formUtm({ querySelector: () => null }), true, 'sem a caixa, UTM ligado');
});

// ---------- Rota ----------

function fakeRedirect(t) {
  let hits = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits++;
      if (req.headers.authorization !== 'Bearer chave') { res.writeHead(401); return res.end('{}'); }
      const id = decodeURIComponent(req.url.split('/')[3]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ clicks: id === 'dsp-1' ? 47 : 0, unique: id === 'dsp-1' ? 31 : 0, groups: {} }));
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ url: `http://127.0.0.1:${server.address().port}`, hits: () => hits });
    });
  });
}

async function bootUi(t, cfg) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-clicks-ui-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({ version: 2, messages: [{ id: 'm', name: 'Oi', text: 'x' }], schedules: [] }));
  const { server, port } = await startUi({ schedulesPath: path, cfg: { uiPort: 0, timezone: SP, logPath: join(tmpdir(), 'x.jsonl'), ...cfg } });
  t.after(() => server.close());
  return (p) => fetch(`http://127.0.0.1:${port}${p}`);
}

test('GET /api/clicks consulta o redirecionador com a chave, cacheia por 60 s e devolve vazio quando desligado', async (t) => {
  const redirect = await fakeRedirect(t);
  const call = await bootUi(t, { clicksUrl: redirect.url, clicksApiKey: 'chave' });
  const first = await (await call('/api/clicks?dispatch=dsp-1&dispatch=dsp-2&dispatch=dsp-1')).json();
  assert.deepEqual(first, { 'dsp-1': { clicks: 47, unique: 31, groups: {} }, 'dsp-2': { clicks: 0, unique: 0, groups: {} } });
  assert.equal(redirect.hits(), 2, 'um pedido por id, sem repetir o duplicado');
  await call('/api/clicks?dispatch=dsp-1');
  assert.equal(redirect.hits(), 2, 'a segunda consulta vem do cache');
  assert.equal((await (await call('/api/status')).json()).clicks, 'on');

  const off = await bootUi(t, {});
  assert.deepEqual(await (await off('/api/clicks?dispatch=dsp-1')).json(), {});
  assert.equal((await (await off('/api/status')).json()).clicks, 'off');
});

// ---------- App ----------

function routedFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url.split('?')[0]}`];
    if (!handler) throw new Error(`rota não prevista no teste: ${method} ${url}`);
    const [status, payload] = handler(body);
    return { ok: status < 400, status, json: async () => payload };
  };
  return { fetch, calls };
}

test('salvar agendamento manda utm false quando a caixa está desmarcada', async () => {
  const { fetch, calls } = routedFetch({
    'POST /api/schedules': (body) => [201, { id: 'sch-new', ...body, enabled: true }],
    'GET /api/schedules': () => [200, []], 'GET /api/messages': () => [200, []], 'GET /api/lists': () => [200, []],
    'GET /api/settings': () => [200, { paused: false, quietHours: null, hourlyLimit: 50, alerts: { whatsapp: true, pushUrl: '' } }],
    'GET /api/status': () => [200, { now: new Date().toISOString(), timezone: SP, scheduler: { state: 'running' }, nextRuns: {}, clicks: 'off' }],
    'GET /api/cron/preview': () => [200, { valid: true, next: [] }],
  });
  installDom(fetch);
  Object.assign(app.state, {
    schedules: [], messages: [{ id: 'm', name: 'Oi', text: 'x' }], groups: [{ id: '1@g.us', name: 'A' }], groupLists: [], settings: null,
    session: null, clicks: {}, groupsLoaded: true, groupsError: null, logs: [], status: null, statusError: null, clockOffset: 0,
    tab: 'schedules', editing: null, sending: false,
  });
  app.openScheduleEditor();
  const f = fakeForm(scheduleForm({ schedule: { name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'], utm: false }, messages: app.state.messages, groups: app.state.groups }));
  await app.handleSubmit({ target: f, preventDefault() {} });
  assert.equal(calls.find((c) => c.method === 'POST').body.utm, false);
});
