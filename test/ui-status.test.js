import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';
import { writeStatus, statusPathFor } from '../src/scheduler-status.js';

function newStore() {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-status-ui-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'segunda', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'pausado', cron: '0 9 * * 2', messageId: 'msg-a', enabled: false },
    ],
  }));
  return path;
}

async function fetchStatus(t, schedulesPath) {
  const cfg = { uiPort: 0, timezone: 'America/Sao_Paulo', logPath: join(tmpdir(), 'nao-usado.jsonl') };
  const { server, port } = await startUi({ schedulesPath, cfg });
  t.after(() => server.close());
  return (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
}

const beating = (extra = {}) => ({
  pid: 1,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  beatAt: new Date().toISOString(),
  active: ['segunda'],
  reloadError: null,
  ...extra,
});

test('sem arquivo de status, o agendador está parado', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.equal(status.scheduler.state, 'stopped');
  assert.equal(status.scheduler.beatAt, null);
});

test('com sinal de vida recente, o agendador está rodando', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating());
  assert.equal((await fetchStatus(t, path)).scheduler.state, 'running');
});

test('sinal de vida antigo é agendador que parou de responder', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating({ beatAt: new Date(Date.now() - 120_000).toISOString() }));
  const status = await fetchStatus(t, path);
  assert.equal(status.scheduler.state, 'unresponsive');
  assert.ok(status.scheduler.beatAt);
});

test('recarga recusada chega à tela', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating({ reloadError: 'JSON inválido' }));
  assert.equal((await fetchStatus(t, path)).scheduler.reloadError, 'JSON inválido');
});

test('status corrompido conta como parado, sem 500', async (t) => {
  const path = newStore();
  writeFileSync(statusPathFor(path), '{ quebrado');
  assert.equal((await fetchStatus(t, path)).scheduler.state, 'stopped');
});

test('devolve o fuso configurado, o nome dele e o relógio do servidor', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.equal(status.timezone, 'America/Sao_Paulo');
  assert.equal(status.timezoneLabel, 'Horário Padrão de Brasília');
  assert.ok(Math.abs(Date.parse(status.now) - Date.now()) < 5000);
});

test('próximo envio só dos ativos, calculado no fuso configurado', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.deepEqual(Object.keys(status.nextRuns), ['sch-a']);
  // "0 9 * * 1" em São Paulo (UTC-3, sem horário de verão) é segunda às 12:00 UTC.
  const next = new Date(status.nextRuns['sch-a']);
  assert.equal(next.getUTCDay(), 1);
  assert.equal(next.getUTCHours(), 12);
  assert.equal(next.getUTCMinutes(), 0);
});
