import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
import { loadSchedules } from '../src/schedules.js';

function writeSchedules(content) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-sched-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

test('carrega agendamentos válidos aplicando o default de enabled', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [
      { name: 'manha', cron: '0 9 * * 1', message: 'oi', groups: ['2@g.us'] },
      { name: 'tarde', cron: '0 15 * * *', message: 'boa tarde', groups: ['2@g.us'], enabled: false },
    ],
  });

  const { defaultGroups, schedules } = loadSchedules(path);
  assert.deepEqual(defaultGroups, ['1@g.us']);
  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].enabled, true, 'enabled deve assumir true quando ausente');
  assert.equal(schedules[1].enabled, false);
});

test('agendamento sem groups herda defaultGroups', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us', '2@g.us'],
    schedules: [{ name: 'herda', cron: '0 9 * * 1', message: 'oi' }],
  });

  assert.deepEqual(loadSchedules(path).schedules[0].groups, ['1@g.us', '2@g.us']);
});

test('cron inválido é recusado e o erro nomeia o agendamento', () => {
  const path = writeSchedules({
    schedules: [{ name: 'quebrado', cron: 'não-é-cron', message: 'x', groups: ['1@g.us'] }],
  });

  assert.throws(() => loadSchedules(path), /Agendamento "quebrado".*cron inválida/s);
});

test('campos obrigatórios ausentes são recusados', () => {
  const semMensagem = writeSchedules({
    schedules: [{ name: 'sem-msg', cron: '0 9 * * 1', groups: ['1@g.us'] }],
  });
  assert.throws(() => loadSchedules(semMensagem), /"message" é obrigatório/);

  const semCron = writeSchedules({ schedules: [{ name: 'sem-cron', message: 'x' }] });
  assert.throws(() => loadSchedules(semCron), /"cron" é obrigatório/);
});

test('agendamento sem nenhum grupo de destino é recusado', () => {
  const path = writeSchedules({
    schedules: [{ name: 'sem-grupo', cron: '0 9 * * 1', message: 'x' }],
  });
  assert.throws(() => loadSchedules(path), /nenhum grupo de destino/);
});

test('nomes duplicados são recusados', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [
      { name: 'igual', cron: '0 9 * * 1', message: 'a' },
      { name: 'igual', cron: '0 10 * * 1', message: 'b' },
    ],
  });
  assert.throws(() => loadSchedules(path), /nome duplicado/);
});

test('arquivo ausente e JSON inválido geram erro com contexto', () => {
  assert.throws(() => loadSchedules('/caminho/que/nao/existe.json'), /Não foi possível ler/);

  const quebrado = writeSchedules('{ isso não é json }');
  assert.throws(() => loadSchedules(quebrado), /JSON inválido/);
});

test('schedules.json de exemplo do repositório é válido', () => {
  const { schedules } = loadSchedules(join(projectRoot, 'schedules.json'));
  assert.ok(Array.isArray(schedules));
});
