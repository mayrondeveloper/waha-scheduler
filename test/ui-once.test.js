// Envio único na tela: bloco Repetir / Uma vez, leitura do formulário, card
// e o que o save manda para a API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { scheduleForm, scheduleList, formWhen } from '../public/schedules-view.js';
import { describeAt } from '../public/dates.js';

const KNOWN_GROUP = '111111111111111111@g.us';
const MESSAGES = [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }];
const NOW = Date.parse('2026-09-11T18:00:00Z');
const SP = 'America/Sao_Paulo';

function form(schedule) {
  return scheduleForm({ schedule: { messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true, ...schedule }, messages: MESSAGES, groups: [] });
}

// ---------- Vistas ----------

test('describeAt escreve a data de parede por extenso, com o ano só quando não é o corrente', () => {
  assert.equal(describeAt('2026-09-13T10:00', { timeZone: SP, now: NOW }), 'dom 13/09, 10:00');
  assert.equal(describeAt('2027-01-04T08:30', { timeZone: SP, now: NOW }), '04/01/2027, 08:30');
  assert.equal(describeAt('', { timeZone: SP, now: NOW }), '');
});

test('agendamento com "at" abre em Uma vez, com data e horário preenchidos', () => {
  const html = form({ id: 'sch-a', name: 'promo', at: '2026-09-13T10:00' });
  assert.match(html, /data-action="when-once" aria-pressed="true"/);
  assert.match(html, /data-action="when-repeat" aria-pressed="false"/);
  assert.match(html, /<div data-role="when-repeat" hidden>/);
  assert.match(html, /<div data-role="when-once" >/);
  const f = fakeForm(html);
  assert.equal(f.querySelector('input[name="mode"]').value, 'once');
  assert.equal(f.querySelector('input[name="date"]').value, '2026-09-13');
  assert.equal(f.querySelector('input[name="onceTime"]').value, '10:00');
  assert.deepEqual(formWhen(f), { at: '2026-09-13T10:00' });
});

test('agendamento com cron abre em Repetir e formWhen devolve o cron', () => {
  const html = form({ id: 'sch-a', name: 'x', cron: '30 8 * * 1,3' });
  assert.match(html, /data-action="when-repeat" aria-pressed="true"/);
  assert.match(html, /<div data-role="when-once" hidden>/);
  assert.deepEqual(formWhen(fakeForm(html)), { cron: '30 8 * * 1,3' });
});

test('modo guardado na edição vence o que o agendamento é; Uma vez sem data dá at vazio', () => {
  const html = form({ id: 'sch-a', name: 'x', cron: '30 8 * * 1,3', mode: 'once' });
  assert.match(html, /data-action="when-once" aria-pressed="true"/);
  assert.deepEqual(formWhen(fakeForm(html)), { at: '' });
});

test('card de envio único: data por extenso, e os estados Enviado e Perdido', () => {
  const base = { messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true };
  const html = scheduleList({
    schedules: [
      { ...base, id: 'a', name: 'pendente', at: '2026-09-13T10:00' },
      { ...base, id: 'b', name: 'feito', at: '2026-09-10T10:00', firedAt: '2026-09-10T13:00:20.000Z' },
      { ...base, id: 'c', name: 'perdido', at: '2026-09-11T09:00', missedAt: '2026-09-11T12:30:00.000Z' },
    ],
    messages: MESSAGES,
    nextRuns: { a: '2026-09-13T13:00:00.000Z', b: null, c: null },
    timeZone: SP,
    now: NOW,
  });
  assert.match(html, /Uma vez · dom 13\/09, 10:00/);
  assert.match(html, /Próximo: <strong>dom 13\/09, 10:00<\/strong>/);
  assert.match(html, /badge tone-waiting"><span class="dot" aria-hidden="true"><\/span>Enviado</);
  assert.match(html, /Enviado em <strong>ontem, 10:00<\/strong>/);
  assert.match(html, /badge tone-error"><span class="dot" aria-hidden="true"><\/span>Perdido</);
  assert.match(html, /Perdido · o agendador estava parado às 09:00/);
  assert.match(html, /schedule-card has-failure/, 'perdido destaca o card como falha');
});

// ---------- App ----------

const statusBody = () => [200, {
  now: new Date().toISOString(), timezone: SP, timezoneLabel: 'Horário Padrão de Brasília',
  scheduler: { state: 'running', startedAt: null, beatAt: new Date().toISOString(), reloadError: null },
  nextRuns: {},
}];

function routedFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url.split('?')[0]}`];
    if (!handler) throw new Error(`rota não prevista no teste: ${method} ${url}`);
    const [status, payload] = handler(body);
    return { ok: status < 400, status, json: async () => payload };
  };
  return { fetch, calls };
}

function resetState(extra = {}) {
  Object.assign(app.state, {
    schedules: [], messages: MESSAGES, groups: [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }], groupLists: [],
    groupsLoaded: true, groupsError: null, logs: [], status: null, statusError: null, clockOffset: 0,
    tab: 'schedules', editing: null, sending: false, ...extra,
  });
}

const routes = () => routedFetch({
  'POST /api/schedules': (body) => [201, { id: 'sch-new', ...body, enabled: true }],
  'GET /api/schedules': () => [200, []],
  'GET /api/messages': () => [200, MESSAGES],
  'GET /api/lists': () => [200, []],
  'GET /api/status': statusBody,
  'GET /api/cron/preview': () => [200, { valid: true, next: [] }],
});

test('salvar em Uma vez manda "at" sem "cron", e a prévia não pede nada ao servidor', async () => {
  const { fetch, calls } = routes();
  const $ = installDom(fetch);
  resetState();
  app.openScheduleEditor();

  const f = fakeForm(form({ name: 'promo', at: '2026-09-13T10:00' }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.at, '2026-09-13T10:00');
  assert.equal('cron' in post.body, false);
  assert.deepEqual(post.body.groupLists, []);
  assert.equal(calls.some((c) => c.url.startsWith('/api/cron/preview')), false, 'envio único não tem prévia de cron');
  assert.equal(app.state.editing, null, 'o painel fecha depois de salvar');
  assert.equal($('#drawer').open, false);
});

test('salvar em Uma vez sem data explica no painel e não chama a API', async () => {
  const { fetch, calls } = routes();
  const $ = installDom(fetch);
  resetState();
  app.openScheduleEditor();

  const f = fakeForm(form({ name: 'promo', cron: '', mode: 'once' }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  assert.equal($('#drawer').querySelector('.form-error').textContent, 'Informe a data e o horário do envio único.');
});

test('abrir um envio único mostra a prévia "Uma vez: …" sem chamar o servidor', async () => {
  const { fetch, calls } = routes();
  const $ = installDom(fetch);
  resetState({ schedules: [{ id: 'sch-a', name: 'promo', at: '2026-09-13T10:00', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true }] });

  app.openScheduleEditor('sch-a');
  await new Promise((r) => setTimeout(r, 0));

  assert.match($('#drawer').querySelector('#preview').textContent, /^Uma vez: dom 13\/09, 10:00$/);
  assert.equal(calls.length, 0);
});

test('alternar para Uma vez troca o campo oculto, guarda o modo e pede a data', () => {
  const { fetch } = routes();
  const $ = installDom(fetch);
  resetState();
  app.openScheduleEditor();

  const f = fakeForm(form({ name: 'x', cron: '0 9 * * 1' }));
  const button = { dataset: { action: 'when-once' }, disabled: false, form: f, closest: () => null };
  app.handleClick({ target: { closest: (selector) => (selector === '[data-action]' ? button : null) } });

  assert.equal(f.querySelector('input[name="mode"]').value, 'once');
  assert.equal(app.state.editing.data.mode, 'once');
  assert.equal($('#drawer').querySelector('#preview').textContent, 'Informe a data e o horário do envio único.');
});
