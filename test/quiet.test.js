import test from 'node:test';
import assert from 'node:assert/strict';
import { inQuietHours, quietEnd } from '../src/quiet.js';

const SP = 'America/Sao_Paulo';
const at = (iso) => Date.parse(iso);
const NIGHT = { start: '22:00', end: '08:00' };
const LUNCH = { start: '12:00', end: '14:00' };

test('janela que vira a meia-noite: dentro à noite e de madrugada, fora de dia', () => {
  assert.equal(inQuietHours(at('2026-09-12T02:30:00Z'), NIGHT, SP), true, '23:30 em SP');
  assert.equal(inQuietHours(at('2026-09-12T09:00:00Z'), NIGHT, SP), true, '06:00 em SP');
  assert.equal(inQuietHours(at('2026-09-12T15:00:00Z'), NIGHT, SP), false, '12:00 em SP');
  assert.equal(inQuietHours(at('2026-09-12T11:00:00Z'), NIGHT, SP), false, '08:00 em SP é o fim, já fora');
  assert.equal(inQuietHours(at('2026-09-13T01:00:00Z'), NIGHT, SP), true, '22:00 em SP é o início, já dentro');
});

test('janela dentro do mesmo dia', () => {
  assert.equal(inQuietHours(at('2026-09-12T16:00:00Z'), LUNCH, SP), true, '13:00');
  assert.equal(inQuietHours(at('2026-09-12T14:59:00Z'), LUNCH, SP), false, '11:59');
  assert.equal(inQuietHours(at('2026-09-12T17:00:00Z'), LUNCH, SP), false, '14:00');
});

test('sem janela nunca está em silêncio', () => {
  assert.equal(inQuietHours(at('2026-09-12T02:30:00Z'), null, SP), false);
});

test('quietEnd é o próximo fim: hoje se ainda não passou, senão amanhã', () => {
  // 23:30 de sexta em SP → fim às 08:00 de sábado (11:00Z)
  assert.equal(quietEnd(at('2026-09-12T02:30:00Z'), NIGHT, SP), at('2026-09-12T11:00:00Z'));
  // 06:00 de sábado → fim às 08:00 do mesmo sábado
  assert.equal(quietEnd(at('2026-09-12T09:00:00Z'), NIGHT, SP), at('2026-09-12T11:00:00Z'));
  // 13:00 → fim do almoço às 14:00 do mesmo dia
  assert.equal(quietEnd(at('2026-09-12T16:00:00Z'), LUNCH, SP), at('2026-09-12T17:00:00Z'));
  // 14:00 em ponto (já fora) → o próximo fim é amanhã
  assert.equal(quietEnd(at('2026-09-12T17:00:00Z'), LUNCH, SP), at('2026-09-13T17:00:00Z'));
});
