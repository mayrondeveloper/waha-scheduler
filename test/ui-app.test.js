// Testes do app.js sem navegador: document e fetch de mentira no globalThis.
// O app.js não executa nada ao ser importado (quem inicia a tela é o
// main.js), então dá para importar e chamar as funções direto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { scheduleForm } from '../public/schedules-view.js';

const KNOWN_GROUP = '111111111111111111@g.us';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const preview = () => [200, { valid: true, next: ['2026-09-14T12:00:00.000Z'] }];
const statusBody = () => [200, {
  now: new Date().toISOString(),
  timezone: 'America/Sao_Paulo',
  timezoneLabel: 'Horário Padrão de Brasília',
  scheduler: { state: 'running', startedAt: null, beatAt: new Date().toISOString(), reloadError: null },
  nextRuns: {},
}];

// fetch de mentira: responde por "MÉTODO caminho" e anota cada chamada.
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
    schedules: [],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    groups: [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }],
    groupsLoaded: true,
    groupsError: null,
    logs: [],
    status: null,
    statusError: null,
    clockOffset: 0,
    tab: 'schedules',
    editing: null,
    sending: false,
    ...extra,
  });
}

// O cron de um agendamento salvo já vem preenchido no formulário: se a prévia
// esperasse o usuário mexer, abrir "Editar" mostraria só o texto de ajuda.
test('abrir um agendamento salvo já mostra a prévia do cron dele', async () => {
  const { fetch, calls } = routedFetch({ 'GET /api/cron/preview': preview });
  const $ = installDom(fetch);
  resetState({
    schedules: [{ id: 'sch-a', name: 'bom-dia', cron: '0 9 * * 1', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true }],
  });

  app.openScheduleEditor('sch-a');
  await tick();

  assert.ok(
    calls.some((c) => c.url === `/api/cron/preview?expr=${encodeURIComponent('0 9 * * 1')}`),
    'a prévia tem que ser pedida para o cron do agendamento aberto'
  );
  assert.match($('#drawer').querySelector('#preview').textContent, /^Próximos envios: /);
  assert.equal($('#drawer').open, true, 'o painel lateral abre');
});

test('mexer nos dias ou no horário atualiza a prévia com o cron montado', async () => {
  const { fetch, calls } = routedFetch({ 'GET /api/cron/preview': preview });
  installDom(fetch);
  resetState();
  const html = scheduleForm({
    schedule: { id: 'sch-a', name: 'bom-dia', cron: '0 9 * * 1,3', messageId: 'msg-a', groups: [KNOWN_GROUP] },
    messages: app.state.messages,
    groups: app.state.groups,
  });

  app.handleInput({ target: { name: 'day', form: fakeForm(html) } });
  await tick();

  assert.ok(calls.some((c) => c.url === `/api/cron/preview?expr=${encodeURIComponent('0 9 * * 1,3')}`));
});

// O risco do "Escrever nova" são duas gravações num salvar só: se a segunda
// falha, a primeira não pode se repetir a cada nova tentativa.
test('"Escrever nova": com o agendamento recusado, a mensagem fica escolhida e não duplica', async () => {
  let attempts = 0;
  const { fetch, calls } = routedFetch({
    'GET /api/cron/preview': preview,
    'POST /api/messages': (body) => [201, { id: 'msg-new', name: body.name, text: body.text }],
    'POST /api/schedules': (body) => {
      attempts += 1;
      return attempts === 1
        ? [400, { error: 'Agendamento "bom-dia": nome duplicado.' }]
        : [201, { id: 'sch-new', ...body, enabled: true }];
    },
    'GET /api/schedules': () => [200, []],
    'GET /api/messages': () => [200, app.state.messages],
    'GET /api/status': statusBody,
  });
  const $ = installDom(fetch);
  resetState();

  app.openScheduleEditor();
  app.state.editing.composing = true;
  app.state.editing.data = { ...app.state.editing.data, name: 'bom-dia', cron: '0 9 * * 1', groups: [KNOWN_GROUP] };
  const first = fakeForm(scheduleForm({
    schedule: app.state.editing.data, messages: app.state.messages, groups: app.state.groups, composing: true,
  }));
  first.querySelector('[name="messageText"]').value = 'Bom dia, *grupo*!';

  await app.handleSubmit({ target: first, preventDefault() {} });

  const messagePosts = () => calls.filter((c) => c.method === 'POST' && c.url === '/api/messages');
  assert.equal(messagePosts().length, 1);
  assert.equal(app.state.editing.composing, false, 'o painel volta com a mensagem nova já escolhida');
  assert.equal(app.state.editing.data.messageId, 'msg-new');
  assert.match($('#drawer').innerHTML, /<option value="msg-new" selected>/);
  assert.equal($('#drawer').querySelector('.form-error').textContent, 'Agendamento "bom-dia": nome duplicado.');

  await app.handleSubmit({ target: fakeForm($('#drawer').innerHTML), preventDefault() {} });

  assert.equal(messagePosts().length, 1, 'tentar de novo não cria outra mensagem');
  const saved = calls.filter((c) => c.method === 'POST' && c.url === '/api/schedules').at(-1).body;
  assert.equal(saved.messageId, 'msg-new');
  assert.equal(app.state.editing, null, 'o painel fecha depois de salvar');
});

// O Esc é tratado no keydown: cancelado ali, o navegador não fecha o painel
// por conta própria, e com alteração não salva a tela pergunta antes.
test('Esc com alteração não salva pergunta antes de fechar o painel', () => {
  const { fetch } = routedFetch({ 'GET /api/cron/preview': preview });
  const $ = installDom(fetch);
  resetState({
    schedules: [{ id: 'sch-a', name: 'bom-dia', cron: '0 9 * * 1', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true }],
  });
  app.openScheduleEditor('sch-a');
  app.state.editing.snapshot = 'o formulário mudou desde que abriu';
  // No DOM de mentira todo seletor acha algo; aqui, como no navegador, não
  // há seletor de emojis aberto.
  const drawer = $('#drawer');
  const find = drawer.querySelector.bind(drawer);
  drawer.querySelector = (selector) => (selector.includes('emoji-panel') ? null : find(selector));

  let prevented = false;
  app.handleKeydown({ key: 'Escape', target: {}, preventDefault() { prevented = true; } });

  assert.equal(prevented, true, 'o keydown do Esc tem que ser cancelado');
  assert.equal($('#drawer').open, true, 'o painel continua aberto até a resposta');
  assert.equal($('#modal').open, true);
  assert.match($('#modal').innerHTML, /Descartar alterações\?/);
});

test('Esc fecha o modal, menos durante um envio', () => {
  const $ = installDom(async () => { throw new Error('rede desligada no teste'); });
  resetState();
  $('#modal').showModal();

  app.state.sending = true;
  app.handleKeydown({ key: 'Escape', target: {}, preventDefault() {} });
  assert.equal($('#modal').open, true, 'durante o envio o modal não fecha');

  app.state.sending = false;
  app.handleKeydown({ key: 'Escape', target: {}, preventDefault() {} });
  assert.equal($('#modal').open, false);
});

test('salvar sem dia marcado não chama a API e explica no painel', async () => {
  const { fetch, calls } = routedFetch({ 'GET /api/cron/preview': preview });
  const $ = installDom(fetch);
  resetState();
  app.openScheduleEditor();
  const form = fakeForm(scheduleForm({ schedule: { name: 'x', groups: [KNOWN_GROUP] }, messages: app.state.messages, groups: app.state.groups }));

  await app.handleSubmit({ target: form, preventDefault() {} });

  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  assert.equal($('#drawer').querySelector('.form-error').textContent, 'Selecione ao menos um dia da semana e o horário.');
});

// ---------- Anexos ----------

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const MEDIA = { id: 'med-1', filename: 'foto.png', mimetype: 'image/png', size: 68, kind: 'image' };
const messageForm = () => fakeForm('<form id="form-message"><input type="text" name="name" value="Foto" /><textarea name="text">Olá</textarea></form>');

function messageRoutes() {
  return routedFetch({
    'POST /api/messages': (body) => [201, { id: 'msg-b', ...body }],
    'PUT /api/messages/msg-a': (body) => [200, { id: 'msg-a', ...body }],
    'GET /api/schedules': () => [200, []],
    'GET /api/messages': () => [200, []],
    'GET /api/status': statusBody,
  });
}

test('salvar mensagem com anexo pendente manda o arquivo em base64', async () => {
  const { fetch, calls } = messageRoutes();
  installDom(fetch);
  resetState();
  app.openMessageEditor();
  app.state.editing.media = { current: null, pending: { filename: 'foto.png', mimetype: 'image/png', size: 68, kind: 'image', data: PNG, src: 'blob:x' } };

  await app.handleSubmit({ target: messageForm(), preventDefault() {} });

  const sent = calls.find((c) => c.method === 'POST').body;
  assert.deepEqual(sent.media, { filename: 'foto.png', mimetype: 'image/png', data: PNG });
});

test('editar mensagem com anexo sem mexer manda media: { id }', async () => {
  const { fetch, calls } = messageRoutes();
  installDom(fetch);
  resetState({ messages: [{ id: 'msg-a', name: 'Foto', text: 'Olá', media: MEDIA }] });
  app.openMessageEditor('msg-a');

  await app.handleSubmit({ target: messageForm(), preventDefault() {} });

  assert.deepEqual(calls.find((c) => c.method === 'PUT').body.media, { id: 'med-1' });
});

test('remover o anexo manda a mensagem sem media', async () => {
  const { fetch, calls } = messageRoutes();
  installDom(fetch);
  resetState({ messages: [{ id: 'msg-a', name: 'Foto', text: 'Olá', media: MEDIA }] });
  app.openMessageEditor('msg-a');

  const button = { dataset: { action: 'remove-media' }, disabled: false, closest: () => null };
  app.handleClick({ target: { closest: (selector) => (selector === '[data-action]' ? button : null) } });
  await app.handleSubmit({ target: messageForm(), preventDefault() {} });

  assert.equal('media' in calls.find((c) => c.method === 'PUT').body, false);
});

test('salvar mensagem manda nome e texto crus, com os marcadores', async () => {
  const { fetch, calls } = routedFetch({
    'POST /api/messages': (body) => [201, { id: 'msg-b', ...body }],
    'GET /api/schedules': () => [200, []],
    'GET /api/messages': () => [200, []],
    'GET /api/status': statusBody,
  });
  installDom(fetch);
  resetState();
  app.openMessageEditor();
  const form = fakeForm('<form id="form-message"><input type="text" name="name" value="Promo" /><textarea name="text">*Oferta* do dia 📚</textarea></form>');

  await app.handleSubmit({ target: form, preventDefault() {} });

  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { name: 'Promo', text: '*Oferta* do dia 📚' });
});
