// Duplicar agendamento e mensagem pela tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { scheduleList } from '../public/schedules-view.js';
import { messageList } from '../public/messages-view.js';

const KNOWN_GROUP = '111111111111111111@g.us';
const MEDIA = { id: 'med-1', filename: 'foto.png', mimetype: 'image/png', size: 70, kind: 'image' };
const MESSAGES = [{ id: 'msg-a', name: 'Oi', text: 'Olá!', media: MEDIA }];

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

const statusBody = () => [200, {
  now: new Date().toISOString(), timezone: 'America/Sao_Paulo', timezoneLabel: 'Horário Padrão de Brasília',
  scheduler: { state: 'running', startedAt: null, beatAt: new Date().toISOString(), reloadError: null }, nextRuns: {},
}];

function resetState(extra = {}) {
  Object.assign(app.state, {
    schedules: [
      { id: 'sch-a', name: 'Promo', at: '2026-01-01T10:00', messageId: 'msg-a', groups: [KNOWN_GROUP], groupLists: ['lst-1'], enabled: true, firedAt: '2026-01-01T13:00:00.000Z' },
      { id: 'sch-b', name: 'Promo (cópia)', cron: '0 9 * * 1', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
    ],
    messages: MESSAGES, groups: [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }],
    groupLists: [{ id: 'lst-1', name: 'Lista', groups: [KNOWN_GROUP] }],
    groupsLoaded: true, groupsError: null, logs: [], status: null, statusError: null, clockOffset: 0,
    tab: 'schedules', editing: null, sending: false, ...extra,
  });
}

const click = (action, id) => {
  const button = { dataset: { action, id }, disabled: false, closest: () => null };
  app.handleClick({ target: { closest: (selector) => (selector === '[data-action]' ? button : null) } });
};

test('copyName acrescenta "(cópia)" e numera quando o nome já existe', () => {
  assert.equal(app.copyName('Promo', ['Outro']), 'Promo (cópia)');
  assert.equal(app.copyName('Promo', ['Promo', 'Promo (cópia)']), 'Promo (cópia 2)');
  assert.equal(app.copyName('Promo', ['Promo (cópia)', 'Promo (cópia 2)']), 'Promo (cópia 3)');
});

test('as listas oferecem Duplicar no menu do card e na linha da mensagem', () => {
  const cards = scheduleList({ schedules: app.state.schedules ?? [], messages: MESSAGES });
  resetState();
  assert.match(scheduleList({ schedules: app.state.schedules, messages: MESSAGES }), /data-action="duplicate" data-id="sch-a"/);
  assert.match(messageList({ messages: MESSAGES, schedules: [] }), /data-action="duplicate-message" data-id="msg-a"/);
  assert.equal(typeof cards, 'string');
});

test('duplicar agendamento abre o painel sem id, com nome numerado, grupos e listas, e sem o resultado do envio único', async () => {
  const { fetch } = routedFetch({ 'GET /api/cron/preview': () => [200, { valid: true, next: [] }] });
  const $ = installDom(fetch);
  resetState();

  click('duplicate', 'sch-a');

  const data = app.state.editing.data;
  assert.equal(data.id, undefined);
  assert.equal(data.name, 'Promo (cópia 2)');
  assert.equal(data.at, '2026-01-01T10:00');
  assert.deepEqual(data.groupLists, ['lst-1']);
  assert.equal('firedAt' in data, false);
  assert.match($('#drawer').innerHTML, /Novo agendamento/);
  assert.match($('#drawer').innerHTML, /value="Promo \(cópia 2\)"/);
});

test('duplicar mensagem abre o painel com o texto e manda o anexo por id ao salvar', async () => {
  const { fetch, calls } = routedFetch({
    'POST /api/messages': (body) => [201, { id: 'msg-b', ...body }],
    'GET /api/schedules': () => [200, []],
    'GET /api/messages': () => [200, MESSAGES],
    'GET /api/lists': () => [200, []],
    'GET /api/status': statusBody,
  });
  const $ = installDom(fetch);
  resetState({ tab: 'messages' });

  click('duplicate-message', 'msg-a');
  assert.equal(app.state.editing.type, 'message');
  assert.equal(app.state.editing.data.id, undefined);
  assert.match($('#drawer').innerHTML, /Nova mensagem/);
  assert.match($('#drawer').innerHTML, /value="Oi \(cópia\)"/);
  assert.match($('#drawer').innerHTML, /src="\/api\/media\/med-1"/, 'o anexo do original aparece na prévia');

  const f = fakeForm('<form id="form-message"><input type="text" name="name" value="Oi (cópia)" /><textarea name="text">Olá!</textarea></form>');
  await app.handleSubmit({ target: f, preventDefault() {} });

  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { name: 'Oi (cópia)', text: 'Olá!', media: { id: 'med-1' } });
});
