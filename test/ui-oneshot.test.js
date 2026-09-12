// Envio único e listas nas rotas de agendamento, no status e no disparo manual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockWaha } from '../harness/mock-waha.js';
import { startUi } from '../src/ui/server.js';
import { instantToWall } from '../src/dates.js';

const TZ = 'America/Sao_Paulo';
const MOCK_PORT = 3993;

function newStore(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-once-ui-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    groupLists: [{ id: 'lst-a', name: 'Lista', groups: ['111111111111111111@g.us', '222222222222222222@g.us'] }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return { path, dir };
}

async function boot(t, { path, dir }, extraCfg = {}) {
  const cfg = { uiPort: 0, timezone: TZ, logPath: join(dir, 'sends.jsonl'), delayMinMs: 0, delayMaxMs: 0, ...extraCfg };
  const { server, port } = await startUi({ schedulesPath: path, cfg });
  t.after(() => server.close());
  return (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init);
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const post = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
const future = () => instantToWall(Date.now() + 3_600_000, TZ);

test('cria envio único no futuro; no passado responde 400', async (t) => {
  const call = await boot(t, newStore());
  const at = future();
  const res = await call('/api/schedules', json('POST', { name: 'promo', at, messageId: 'msg-a', groups: ['1@g.us'] }));
  const created = await res.json();
  assert.equal(res.status, 201, JSON.stringify(created));
  assert.equal(created.at, at);
  assert.equal('cron' in created, false);

  const past = await call('/api/schedules', json('POST', { name: 'velho', at: '2020-01-01T10:00', messageId: 'msg-a', groups: ['1@g.us'] }));
  assert.equal(past.status, 400);
  assert.match((await past.json()).error, /horário no futuro/);

  const both = await call('/api/schedules', json('POST', { name: 'ambos', at, cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] }));
  assert.equal(both.status, 400);
});

test('cria com lista e sem grupos avulsos; lista inexistente responde 400', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/schedules', json('POST', { name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-a'] }));
  const created = await res.json();
  assert.equal(res.status, 201, JSON.stringify(created));
  assert.deepEqual(created.groupLists, ['lst-a']);
  assert.deepEqual(created.groups, []);

  const bad = await call('/api/schedules', json('POST', { name: 'y', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-zz'] }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /a lista "lst-zz" não existe/);
});

test('PUT mantém firedAt com o mesmo "at" e limpa quando o horário muda', async (t) => {
  const at = future();
  const store = newStore({
    schedules: [{ id: 'sch-a', name: 'promo', at, messageId: 'msg-a', groups: ['1@g.us'], firedAt: '2026-01-01T13:00:00.000Z' }],
  });
  const call = await boot(t, store);
  const base = { name: 'promo', messageId: 'msg-a', groups: ['1@g.us'] };

  const kept = await (await call('/api/schedules/sch-a', json('PUT', { ...base, at }))).json();
  assert.equal(kept.firedAt, '2026-01-01T13:00:00.000Z');

  const moved = await (await call('/api/schedules/sch-a', json('PUT', { ...base, at: instantToWall(Date.now() + 7_200_000, TZ) }))).json();
  assert.equal('firedAt' in moved, false, 'horário novo reativa o envio');

  // O corpo não escolhe firedAt: mandar um é ignorado.
  const forged = await (await call('/api/schedules/sch-a', json('PUT', { ...base, cron: '0 9 * * 1', firedAt: '2026-01-01T00:00:00Z' }))).json();
  assert.equal('firedAt' in forged, false);
  assert.equal('at' in forged, false);
});

test('status: nextRuns do envio único é o próprio horário, e nulo depois de disparar', async (t) => {
  const at = future();
  const call = await boot(t, newStore({
    schedules: [
      { id: 'sch-once', name: 'promo', at, messageId: 'msg-a', groups: ['1@g.us'] },
      { id: 'sch-done', name: 'feito', at: '2026-01-01T10:00', messageId: 'msg-a', groups: ['1@g.us'], firedAt: '2026-01-01T13:00:00.000Z' },
      { id: 'sch-cron', name: 'cron', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] },
    ],
  }));
  const status = await (await call('/api/status')).json();
  assert.equal(status.nextRuns['sch-once'], new Date(Date.parse(`${at}:00-03:00`)).toISOString());
  assert.equal(status.nextRuns['sch-done'], null);
  assert.ok(status.nextRuns['sch-cron']);
});

test('disparo manual envia para a união dos grupos avulsos e das listas', async (t) => {
  const { server: mock, calls } = await startMockWaha(MOCK_PORT);
  t.after(() => mock.close());
  const call = await boot(t, newStore({
    schedules: [{ id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['222222222222222222@g.us'], groupLists: ['lst-a'] }],
  }), { wahaUrl: `http://localhost:${MOCK_PORT}`, session: 'default', apiKey: '' });

  const result = await (await call('/api/schedules/sch-a/run', post())).json();
  assert.equal(result.sent, 2);
  assert.deepEqual(calls.map((c) => c.chatId), ['222222222222222222@g.us', '111111111111111111@g.us']);
});
