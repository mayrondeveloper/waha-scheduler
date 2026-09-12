// Envios únicos ("at"): o tique do agendador dispara, dá como perdido e grava
// o resultado no arquivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler, dueAction, GRACE_MS } from '../src/index.js';
import { readStatus, statusPathFor } from '../src/scheduler-status.js';
import { instantToWall } from '../src/dates.js';
import { config } from '../src/config.js';

const TZ = 'America/Sao_Paulo';
const cfg = { ...config, timezone: TZ };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O vigia da sessão consulta o WAHA no boot: nos testes, nunca o real.
const offlineClient = { async getSession() { throw new Error('offline no teste'); } };

function writeConfig(path, schedule) {
  writeFileSync(path, JSON.stringify({
    version: 2,
    groupLists: [{ id: 'lst-1', name: 'Lista', groups: ['2@g.us', '3@g.us'] }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-once', name: 'promo', messageId: 'msg-a', groups: ['1@g.us'], groupLists: ['lst-1'], ...schedule }],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-once-')), 'schedules.json');
}

const readBack = (path) => JSON.parse(readFileSync(path, 'utf8')).schedules[0];

function fakeSend() {
  const calls = [];
  return { calls, send: async (message, targets, opts) => { calls.push({ message, targets, opts }); return { sent: targets.length, failed: 0 }; } };
}

test('dueAction: espera no futuro, dispara até a tolerância, perde depois dela, nada depois do resultado', () => {
  const nowMs = Date.parse('2026-09-13T13:00:00Z'); // 10:00 em São Paulo
  const base = { enabled: true };
  assert.equal(dueAction({ ...base, at: '2026-09-13T10:01' }, nowMs, TZ), 'wait');
  assert.equal(dueAction({ ...base, at: '2026-09-13T10:00' }, nowMs, TZ), 'fire');
  assert.equal(dueAction({ ...base, at: '2026-09-13T09:51' }, nowMs, TZ), 'fire');
  assert.equal(dueAction({ ...base, at: '2026-09-13T09:49' }, nowMs, TZ), 'missed');
  assert.equal(dueAction({ ...base, at: '2026-09-13T10:00', firedAt: '2026-09-13T13:00:01Z' }, nowMs, TZ), 'done');
  assert.equal(dueAction({ ...base, at: '2026-09-13T10:00', enabled: false }, nowMs, TZ), 'wait');
  assert.equal(dueAction({ ...base, cron: '0 9 * * 1' }, nowMs, TZ), 'wait');
  assert.equal(GRACE_MS, 600_000);
});

test('envio único vencido dispara uma vez, para a união dos grupos, e grava firedAt antes de enviar', async (t) => {
  const path = newPath();
  writeConfig(path, { at: instantToWall(Date.now() - 60_000, TZ) });
  const { calls, send } = fakeSend();
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, cfg, tickMs: 40, send });
  t.after(() => scheduler.stop());

  await delay(150);
  assert.equal(calls.length, 1, 'um tique só dispara uma vez');
  assert.equal(calls[0].message, 'Olá!');
  assert.deepEqual(calls[0].targets, ['1@g.us', '2@g.us', '3@g.us']);
  assert.equal(calls[0].opts.label, 'promo');
  assert.match(readBack(path).firedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(scheduler.activeNames, [], 'depois de disparar não conta como ativo');
});

test('vencido há mais que a tolerância vira missedAt sem enviar', async (t) => {
  const path = newPath();
  writeConfig(path, { at: instantToWall(Date.now() - GRACE_MS - 120_000, TZ) });
  const { calls, send } = fakeSend();
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, cfg, tickMs: 40, send });
  t.after(() => scheduler.stop());

  await delay(120);
  assert.equal(calls.length, 0);
  const saved = readBack(path);
  assert.match(saved.missedAt, /^\d{4}-/);
  assert.equal('firedAt' in saved, false);
});

test('envio único no futuro fica pendente, conta como ativo e aparece no status', async (t) => {
  const path = newPath();
  writeConfig(path, { at: instantToWall(Date.now() + 3_600_000, TZ) });
  const { calls, send } = fakeSend();
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, cfg, tickMs: 40, send });
  t.after(() => scheduler.stop());

  await delay(100);
  assert.equal(calls.length, 0);
  assert.deepEqual(scheduler.activeNames, ['promo']);
  const status = readStatus(statusPathFor(path));
  assert.deepEqual(status.active, ['promo']);
  assert.deepEqual(status.oneShots, ['promo']);
});

test('recarga com "at" novo reativa um envio único já disparado', async (t) => {
  const path = newPath();
  writeConfig(path, { at: '2026-01-01T10:00', firedAt: '2026-01-01T13:00:00.000Z' });
  const { calls, send } = fakeSend();
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, cfg, tickMs: 40, send });
  t.after(() => scheduler.stop());
  assert.deepEqual(scheduler.activeNames, []);

  writeConfig(path, { at: instantToWall(Date.now() - 30_000, TZ) });
  assert.equal(scheduler.reload(), true);
  assert.deepEqual(scheduler.activeNames, ['promo']);
  await scheduler.tick();
  assert.equal(calls.length, 1);
});

test('agendamento desabilitado com "at" não dispara', async (t) => {
  const path = newPath();
  writeConfig(path, { at: instantToWall(Date.now() - 30_000, TZ), enabled: false });
  const { calls, send } = fakeSend();
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, cfg, tickMs: 40, send });
  t.after(() => scheduler.stop());
  await delay(100);
  assert.equal(calls.length, 0);
  assert.equal('firedAt' in readBack(path), false);
});
