import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../src/index.js';

function writeConfig(path, cronDoSegundo) {
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'primeiro', cron: '0 9 * * 1', messageId: 'msg-a' },
      ...(cronDoSegundo
        ? [{ id: 'sch-b', name: 'segundo', cron: cronDoSegundo, messageId: 'msg-a' }]
        : []),
    ],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-reload-')), 'schedules.json');
}

test('reload aplica agendamento novo sem reiniciar', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['primeiro']);

  writeConfig(path, '0 10 * * 1');
  scheduler.reload();

  assert.deepEqual(scheduler.activeNames, ['primeiro', 'segundo']);
});

test('reload com config inválida preserva a anterior e não derruba', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  writeFileSync(path, '{ isso não é json }');
  const ok = scheduler.reload();

  assert.equal(ok, false, 'reload deve reportar falha');
  assert.deepEqual(scheduler.activeNames, ['primeiro'], 'config anterior preservada');
});

test('agendamento desabilitado não entra nos ativos', (t) => {
  const path = newPath();
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'ligado', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'desligado', cron: '0 9 * * 2', messageId: 'msg-a', enabled: false },
    ],
  }));

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['ligado']);
});
