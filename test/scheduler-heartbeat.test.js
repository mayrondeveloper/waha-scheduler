import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../src/index.js';
import { readStatus, statusPathFor } from '../src/scheduler-status.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O vigia da sessão consulta o WAHA no boot: nos testes, nunca o real.
const offlineClient = { async getSession() { throw new Error('offline no teste'); } };

function writeConfig(path, cron = '0 9 * * 1') {
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'primeiro', cron, messageId: 'msg-a' }],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-beat-')), 'schedules.json');
}

test('ao subir, o agendador grava o status ao lado do arquivo de agendamentos', (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path });
  t.after(() => scheduler.stop());

  const status = readStatus(statusPathFor(path));
  assert.equal(status.pid, process.pid);
  assert.deepEqual(status.active, ['primeiro']);
  assert.equal(status.reloadError, null);
  assert.ok(Date.parse(status.startedAt) <= Date.parse(status.beatAt));
});

test('o sinal de vida é regravado no intervalo', async (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, heartbeatMs: 20 });
  t.after(() => scheduler.stop());

  const first = readStatus(statusPathFor(path)).beatAt;
  await delay(80);
  assert.notEqual(readStatus(statusPathFor(path)).beatAt, first);
});

test('recarga recusada vai para o status e some na recarga seguinte', (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path });
  t.after(() => scheduler.stop());

  writeFileSync(path, '{ isso não é json }');
  scheduler.reload();
  const refused = readStatus(statusPathFor(path));
  assert.match(refused.reloadError, /JSON inválido/);
  assert.deepEqual(refused.active, ['primeiro'], 'a configuração anterior continua ativa');

  writeConfig(path, '0 10 * * 1');
  scheduler.reload();
  assert.equal(readStatus(statusPathFor(path)).reloadError, null);
});

test('stop apaga o status', () => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path });
  scheduler.stop();
  assert.equal(existsSync(statusPathFor(path)), false);
});

test('falha ao gravar o status não derruba o agendador', (t) => {
  const path = newPath();
  writeConfig(path);
  // Um arquivo no lugar da pasta: toda gravação do status falha.
  const scheduler = startScheduler({ client: offlineClient, schedulesPath: path, statusPath: join(path, 'status.json') });
  t.after(() => scheduler.stop());
  assert.deepEqual(scheduler.activeNames, ['primeiro']);
});
