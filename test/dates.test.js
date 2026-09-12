import test from 'node:test';
import assert from 'node:assert/strict';
import { wallToInstant, instantToWall, isWall } from '../src/dates.js';

test('wallToInstant converte hora de parede em São Paulo (UTC-3)', () => {
  assert.equal(wallToInstant('2026-09-13T10:00', 'America/Sao_Paulo'), Date.parse('2026-09-13T13:00:00Z'));
});

test('wallToInstant respeita o horário de verão de Nova York nos dois lados da virada', () => {
  // 2026-03-08 é o segundo domingo de março: começa o horário de verão.
  assert.equal(wallToInstant('2026-03-07T12:00', 'America/New_York'), Date.parse('2026-03-07T17:00:00Z'));
  assert.equal(wallToInstant('2026-03-09T12:00', 'America/New_York'), Date.parse('2026-03-09T16:00:00Z'));
});

test('wallToInstant recusa formato errado e data inexistente', () => {
  assert.throws(() => wallToInstant('2026-9-13 10:00', 'America/Sao_Paulo'), /Data\/hora inválida/);
  assert.throws(() => wallToInstant('2026-02-30T10:00', 'America/Sao_Paulo'), /Data\/hora inválida/);
  assert.throws(() => wallToInstant('2026-02-10T24:00', 'America/Sao_Paulo'), /Data\/hora inválida/);
  assert.throws(() => wallToInstant(null, 'America/Sao_Paulo'), /Data\/hora inválida/);
});

test('isWall aceita só o formato completo com data real', () => {
  assert.equal(isWall('2026-09-13T10:00'), true);
  assert.equal(isWall('2026-09-13'), false);
  assert.equal(isWall('2026-13-01T10:00'), false);
  assert.equal(isWall(20260913), false);
});

test('instantToWall é o inverso de wallToInstant', () => {
  const wall = '2026-12-25T23:45';
  assert.equal(instantToWall(wallToInstant(wall, 'America/Sao_Paulo'), 'America/Sao_Paulo'), wall);
  assert.equal(instantToWall('2026-09-13T13:00:00Z', 'America/Sao_Paulo'), '2026-09-13T10:00');
});
