import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatWhen, formatTime } from '../public/dates.js';

const SP = { timeZone: 'America/Sao_Paulo' };
// Sexta, 11/09/2026, 15:00 em São Paulo (18:00 UTC).
const NOW = Date.parse('2026-09-11T18:00:00Z');

test('mesmo dia, dia seguinte e dia anterior no fuso configurado', () => {
  assert.equal(formatWhen('2026-09-11T21:00:00Z', { ...SP, now: NOW }), 'hoje, 18:00');
  assert.equal(formatWhen('2026-09-12T12:00:00Z', { ...SP, now: NOW }), 'amanhã, 09:00');
  assert.equal(formatWhen('2026-09-11T02:39:00Z', { ...SP, now: NOW }), 'ontem, 23:39');
});

test('o dia vira no fuso configurado, não em UTC', () => {
  // 02:42 UTC do dia 11 ainda é dia 10 em São Paulo, e "agora" também.
  const now = Date.parse('2026-09-11T02:00:00Z');
  assert.equal(formatWhen('2026-09-11T02:42:00Z', { ...SP, now }), 'hoje, 23:42');
});

test('outros dias mostram o dia da semana; outro ano mostra o ano', () => {
  assert.equal(formatWhen('2026-09-18T21:00:00Z', { ...SP, now: NOW }), 'sex 18/09, 18:00');
  assert.equal(formatWhen('2026-09-14T12:00:00Z', { ...SP, now: NOW }), 'seg 14/09, 09:00');
  assert.equal(formatWhen('2025-09-18T21:00:00Z', { ...SP, now: NOW }), '18/09/2025, 18:00');
});

test('meia-noite sai como 00:00 e o horário pode ter segundos', () => {
  assert.equal(formatTime('2026-09-12T03:00:00Z', SP), '00:00');
  assert.equal(formatTime('2026-09-11T12:00:08Z', { ...SP, seconds: true }), '09:00:08');
});

test('o resultado não depende do fuso do processo', () => {
  const module = new URL('../public/dates.js', import.meta.url).href;
  const script = `import { formatWhen } from ${JSON.stringify(module)};
    process.stdout.write(formatWhen('2026-09-11T02:42:00Z',
      { timeZone: 'America/Sao_Paulo', now: Date.parse('2026-09-11T02:00:00Z') }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'UTC' },
  }).toString();
  assert.equal(out, 'hoje, 23:42');
});
