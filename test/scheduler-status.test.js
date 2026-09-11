import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  statusPathFor, writeStatus, readStatus, removeStatus, schedulerState, STALE_AFTER_MS,
} from '../src/scheduler-status.js';

const newDir = () => mkdtempSync(join(tmpdir(), 'waha-status-'));
const SAMPLE = {
  pid: 1,
  startedAt: '2026-09-11T12:00:00.000Z',
  beatAt: '2026-09-11T12:00:15.000Z',
  active: ['bom-dia'],
  reloadError: null,
};

test('o status fica na mesma pasta do arquivo de agendamentos', () => {
  assert.equal(statusPathFor('/x/data/schedules.json'), join('/x/data', 'scheduler-status.json'));
});

test('grava e lê o status, sem sobrar arquivo temporário', () => {
  const dir = newDir();
  const path = join(dir, 'scheduler-status.json');
  writeStatus(path, SAMPLE);
  assert.deepEqual(readStatus(path), SAMPLE);
  assert.deepEqual(readdirSync(dir), ['scheduler-status.json']);
});

test('status ausente é agendador parado, não erro', () => {
  assert.equal(readStatus(join(newDir(), 'scheduler-status.json')), null);
});

test('status corrompido lança erro com o caminho', () => {
  const path = join(newDir(), 'scheduler-status.json');
  writeFileSync(path, '{ quebrado');
  assert.throws(() => readStatus(path), /Status do agendador inválido em .*scheduler-status\.json/);
});

test('falha ao gravar lança erro com o caminho', () => {
  const path = join(newDir(), 'nao-existe', 'scheduler-status.json');
  assert.throws(() => writeStatus(path, SAMPLE), /Não foi possível gravar o status do agendador em/);
});

test('removeStatus apaga o arquivo e não reclama se ele já não existe', () => {
  const path = join(newDir(), 'scheduler-status.json');
  writeStatus(path, SAMPLE);
  removeStatus(path);
  assert.equal(existsSync(path), false);
  removeStatus(path);
});

test('estado do agendador: rodando, parou de responder, parado', () => {
  const beat = Date.parse(SAMPLE.beatAt);
  assert.equal(schedulerState(SAMPLE, beat + 1000), 'running');
  assert.equal(schedulerState(SAMPLE, beat + STALE_AFTER_MS), 'running');
  assert.equal(schedulerState(SAMPLE, beat + STALE_AFTER_MS + 1), 'unresponsive');
  assert.equal(schedulerState({ ...SAMPLE, beatAt: 'lixo' }, beat), 'unresponsive');
  assert.equal(schedulerState(null, beat), 'stopped');
});
