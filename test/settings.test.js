// Ajustes ("settings") e o adiamento ("pending") na validação do arquivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, DEFAULT_SETTINGS, normalizeStore, validateSchedule } from '../src/schedules.js';

test('ajustes ausentes valem os padrões, e o objeto devolvido é independente do padrão', () => {
  const s = validateSettings(undefined);
  assert.deepEqual(s, { paused: false, quietHours: null, hourlyLimit: 50, alerts: { whatsapp: true, pushUrl: '' } });
  s.alerts.whatsapp = false;
  assert.equal(DEFAULT_SETTINGS.alerts.whatsapp, true, 'o padrão não pode ser alterado por fora');
});

test('campos parciais são completados com os padrões', () => {
  const s = validateSettings({ paused: true, alerts: { pushUrl: 'https://ntfy.sh/meu-topico' } });
  assert.equal(s.paused, true);
  assert.equal(s.hourlyLimit, 50);
  assert.equal(s.alerts.whatsapp, true);
  assert.equal(s.alerts.pushUrl, 'https://ntfy.sh/meu-topico');
  assert.equal(s.quietHours, null);
});

test('janela de silêncio exige HH:MM e horários diferentes', () => {
  assert.deepEqual(validateSettings({ quietHours: { start: '22:00', end: '08:00' } }).quietHours, { start: '22:00', end: '08:00' });
  assert.throws(() => validateSettings({ quietHours: { start: '22h', end: '08:00' } }), /"quietHours\.start" deve ser um horário HH:MM/);
  assert.throws(() => validateSettings({ quietHours: { start: '22:00', end: '24:00' } }), /"quietHours\.end"/);
  assert.throws(() => validateSettings({ quietHours: { start: '22:00', end: '22:00' } }), /início e fim diferentes/);
  assert.throws(() => validateSettings({ quietHours: '22-8' }), /"quietHours" deve ser um objeto/);
});

test('limite por hora é inteiro de 0 a 1000; pushUrl é http(s) ou vazia; booleanos são booleanos', () => {
  assert.equal(validateSettings({ hourlyLimit: 0 }).hourlyLimit, 0);
  assert.throws(() => validateSettings({ hourlyLimit: -1 }), /"hourlyLimit"/);
  assert.throws(() => validateSettings({ hourlyLimit: 1.5 }), /"hourlyLimit"/);
  assert.throws(() => validateSettings({ hourlyLimit: 1001 }), /"hourlyLimit"/);
  assert.equal(validateSettings({ alerts: { pushUrl: '  ' } }).alerts.pushUrl, '');
  assert.throws(() => validateSettings({ alerts: { pushUrl: 'ntfy.sh/x' } }), /"alerts\.pushUrl"/);
  assert.throws(() => validateSettings({ paused: 'sim' }), /"paused"/);
  assert.throws(() => validateSettings({ alerts: { whatsapp: 1 } }), /"alerts\.whatsapp"/);
  assert.throws(() => validateSettings([]), /"settings" deve ser um objeto/);
});

test('normalizeStore devolve settings completos, com ou sem o campo no arquivo', () => {
  assert.deepEqual(normalizeStore({ schedules: [] }).settings, DEFAULT_SETTINGS);
  const store = normalizeStore({ settings: { paused: true }, schedules: [] });
  assert.equal(store.settings.paused, true);
  assert.equal(store.settings.hourlyLimit, 50);
  assert.throws(() => normalizeStore({ settings: { hourlyLimit: 'x' }, schedules: [] }), /Ajustes: campo "hourlyLimit"/);
});

test('pending é validado e só entra no objeto quando existe', () => {
  const base = { name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'] };
  const pending = { at: '2026-09-13T11:00:00.000Z', from: '2026-09-13T02:00:00.000Z', reason: 'quiet' };
  assert.deepEqual(validateSchedule({ ...base, pending }).pending, pending);
  assert.equal('pending' in validateSchedule(base), false);
  assert.equal('pending' in validateSchedule({ ...base, pending: null }), false);
  assert.throws(() => validateSchedule({ ...base, pending: { at: 'ontem', from: pending.from, reason: 'quiet' } }), /Agendamento "x": campo "pending" precisa de "at"/);
  assert.throws(() => validateSchedule({ ...base, pending: { at: pending.at, from: pending.from } }), /precisa de "reason"/);
});
