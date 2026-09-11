import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulerNotice, nextDispatch, statusBar } from '../public/status-view.js';

const NOW = Date.parse('2026-09-11T18:00:00Z');
const ACTIVE = [{ id: 'a', name: 'bom-dia', enabled: true }];
const status = (scheduler = {}, extra = {}) => ({
  now: new Date(NOW).toISOString(),
  timezone: 'America/Sao_Paulo',
  timezoneLabel: 'Horário Padrão de Brasília',
  scheduler: { state: 'running', startedAt: null, beatAt: new Date(NOW).toISOString(), reloadError: null, ...scheduler },
  nextRuns: {},
  ...extra,
});
const notice = (s, extra = {}) => schedulerNotice({ status: s, statusError: null, schedules: ACTIVE, now: NOW, ...extra });

test('rodando', () => {
  assert.deepEqual(notice(status()), { tone: 'ok', text: 'Agendador rodando' });
});

test('parado manda rodar npm start', () => {
  const n = notice(status({ state: 'stopped', beatAt: null }));
  assert.equal(n.tone, 'danger');
  assert.equal(n.text, 'Agendador parado');
  assert.match(n.detail, /npm start/);
});

test('sem resposta mostra o último sinal no fuso configurado', () => {
  const n = notice(status({ state: 'unresponsive', beatAt: '2026-09-11T17:50:00Z' }));
  assert.equal(n.text, 'Agendador parou de responder');
  assert.match(n.detail, /Último sinal: hoje, 14:50/);
});

test('recarga recusada é atenção, com o motivo', () => {
  assert.deepEqual(notice(status({ reloadError: 'JSON inválido' })), {
    tone: 'warn',
    text: 'O agendador recusou a última alteração e segue com a anterior',
    detail: 'JSON inválido',
  });
});

test('nenhum agendamento ativo vence o agendador parado', () => {
  const n = notice(status({ state: 'stopped' }), { schedules: [{ id: 'a', name: 'x', enabled: false }] });
  assert.deepEqual(n, { tone: 'neutral', text: 'Nenhum agendamento ativo' });
});

test('sem conexão com o servidor da tela vence tudo', () => {
  const n = notice(status(), { statusError: 'Failed to fetch' });
  assert.equal(n.tone, 'danger');
  assert.equal(n.text, 'Sem conexão com o servidor da tela');
});

test('próximo envio é o mais cedo entre os ativos', () => {
  const schedules = [
    { id: 'a', name: 'depois', enabled: true },
    { id: 'b', name: 'antes', enabled: true },
    { id: 'c', name: 'pausado', enabled: false },
  ];
  const next = nextDispatch(schedules, { a: '2026-09-12T12:00:00Z', b: '2026-09-11T21:00:00Z', c: '2026-09-11T19:00:00Z' });
  assert.equal(next.schedule.name, 'antes');
  assert.equal(nextDispatch(schedules, {}), null);
});

test('a faixa mostra o próximo envio com o agendador rodando, e não com ele parado', () => {
  const nextRuns = { a: '2026-09-11T21:00:00Z' };
  const bar = (scheduler) => statusBar({
    status: status(scheduler, { nextRuns }), statusError: null, groupsError: null,
    groupsLoaded: true, schedules: ACTIVE, now: NOW,
  });
  assert.match(bar({}), /Próximo envio: hoje, 18:00, bom-dia/);
  assert.match(bar({}), /WAHA conectado/);
  assert.doesNotMatch(bar({ state: 'stopped' }), /Próximo envio/);
});

test('WAHA fora do ar aparece na faixa com o erro', () => {
  const html = statusBar({
    status: status(), statusError: null, groupsError: 'Erro 500 ao listar grupos',
    groupsLoaded: true, schedules: ACTIVE, now: NOW,
  });
  assert.match(html, /WAHA indisponível/);
  assert.match(html, /Erro 500 ao listar grupos/);
});

test('nome de agendamento na faixa é escapado', () => {
  const html = statusBar({
    status: status({}, { nextRuns: { a: '2026-09-11T21:00:00Z' } }), statusError: null, groupsError: null,
    groupsLoaded: true, schedules: [{ id: 'a', name: '<img src=x>', enabled: true }], now: NOW,
  });
  assert.doesNotMatch(html, /<img/);
});

// O ponto pulsante é o "indicador de vida do sistema" do design system: só
// o agendador rodando pulsa. WAHA conectado e os estados de erro ficam parados.
test('o ponto do agendador pulsa só quando ele está rodando', () => {
  const bar = (scheduler) => statusBar({
    status: status(scheduler), statusError: null, groupsError: null, groupsLoaded: true, schedules: ACTIVE, now: NOW,
  });
  assert.match(bar({}), /status-item tone-ok is-live/);
  assert.equal(bar({}).match(/is-live/g).length, 1, 'só o item do agendador pulsa');
  assert.doesNotMatch(bar({ state: 'stopped' }), /is-live/);
});
