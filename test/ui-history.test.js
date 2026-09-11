import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDispatches } from '../public/history.js';

const at = (seconds) => new Date(Date.parse('2026-09-11T12:00:00Z') + seconds * 1000).toISOString();
const entry = (seconds, label, chatId, status = 'sent', error) =>
  ({ ts: at(seconds), label, chatId, status, ...(error && { error }) });
// A API devolve do mais recente para o mais antigo.
const newestFirst = (...entries) => entries.reverse();

test('linhas do mesmo disparo viram um só, com a contagem', () => {
  const [dispatch] = groupDispatches(newestFirst(
    entry(0, 'bom-dia', 'a@g.us'),
    entry(5, 'bom-dia', 'b@g.us'),
    entry(11, 'bom-dia', 'c@g.us', 'error', 'Erro 500'),
  ));
  assert.equal(dispatch.name, 'bom-dia');
  assert.equal(dispatch.manual, false);
  assert.equal(dispatch.startedAt, at(0));
  assert.deepEqual(dispatch.entries.map((e) => e.chatId), ['a@g.us', 'b@g.us', 'c@g.us']);
  assert.equal(dispatch.sent, 2);
  assert.equal(dispatch.failed, 1);
});

test('rótulo diferente separa disparos, e o mais recente vem primeiro', () => {
  const dispatches = groupDispatches(newestFirst(entry(0, 'bom-dia', 'a@g.us'), entry(3, 'boa-noite', 'a@g.us')));
  assert.deepEqual(dispatches.map((d) => d.name), ['boa-noite', 'bom-dia']);
});

test('mais de 60 s entre linhas separa disparos do mesmo agendamento', () => {
  assert.equal(groupDispatches(newestFirst(entry(0, 'bom-dia', 'a@g.us'), entry(61, 'bom-dia', 'b@g.us'))).length, 2);
});

test('grupo repetido separa disparos seguidos de um cron a cada minuto', () => {
  const dispatches = groupDispatches(newestFirst(
    entry(0, 'minuto', 'a@g.us'),
    entry(40, 'minuto', 'b@g.us'),
    entry(60, 'minuto', 'a@g.us'),
  ));
  assert.deepEqual(dispatches.map((d) => d.entries.length), [1, 2]);
});

test('envio manual ganha o selo e perde o sufixo do nome', () => {
  const [dispatch] = groupDispatches([entry(0, 'bom-dia (manual)', 'a@g.us')]);
  assert.equal(dispatch.name, 'bom-dia');
  assert.equal(dispatch.manual, true);
});

test('envio pelo terminal tem nome legível', () => {
  assert.equal(groupDispatches([entry(0, 'send-now', 'a@g.us')])[0].name, 'Envio pelo terminal');
});

test('log vazio não tem disparos', () => {
  assert.deepEqual(groupDispatches([]), []);
});
