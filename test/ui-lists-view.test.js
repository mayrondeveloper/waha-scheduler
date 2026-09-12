// Listas de grupos na tela: seleção por lista no agendamento, aba Grupos,
// painel de lista e o que o app manda para a API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { scheduleForm, scheduleList, formGroups, formGroupLists, unionTargets, sendConfirm } from '../public/schedules-view.js';
import { listsView, listForm, listsSubtitle } from '../public/lists-view.js';

const ALPHA = '111111111111111111@g.us';
const BETA = '222222222222222222@g.us';
const GAMMA = '333333333333333333@g.us';
const GROUPS = [{ id: ALPHA, name: 'Grupo Alpha' }, { id: BETA, name: 'Grupo Beta' }, { id: GAMMA, name: 'Grupo Gamma' }];
const LISTS = [{ id: 'lst-1', name: 'Ofertas SP', groups: [ALPHA, BETA] }, { id: 'lst-2', name: 'Comunidade', groups: [GAMMA] }];
const MESSAGES = [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }];
const groupName = (id) => GROUPS.find((g) => g.id === id)?.name ?? id;

test('unionTargets junta avulsos e listas, na ordem e sem repetição', () => {
  assert.deepEqual(unionTargets({ groups: [BETA], groupLists: ['lst-1', 'lst-2'] }, LISTS), [BETA, ALPHA, GAMMA]);
  assert.deepEqual(unionTargets({ groups: [ALPHA] }, LISTS), [ALPHA]);
  assert.deepEqual(unionTargets({ groups: [], groupLists: ['lst-x'] }, LISTS), [], 'lista desconhecida não contribui');
});

test('formulário de agendamento oferece as listas antes dos grupos, marca a salva e conta a união', () => {
  const html = scheduleForm({
    schedule: { id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [GAMMA], groupLists: ['lst-1'], enabled: true },
    messages: MESSAGES, groups: GROUPS, groupLists: LISTS,
  });
  assert.ok(html.indexOf('name="groupList"') < html.indexOf('name="group"'), 'as listas vêm primeiro');
  assert.match(html, /name="groupList" value="lst-1" checked/);
  assert.match(html, /name="groupList" value="lst-2"\s+\/>/, 'a lista não salva vem desmarcada');
  assert.match(html, /Ofertas SP<\/span>\s*<small class="group-id">2 grupos<\/small>/);
  assert.match(html, /id="groups-count">3 selecionados/, 'Gamma avulso + Alpha e Beta pela lista');
  const f = fakeForm(html);
  assert.deepEqual(formGroupLists(f), ['lst-1']);
  assert.deepEqual(formGroups(f), [GAMMA]);
});

test('sem listas no cadastro, o formulário não mostra o bloco de listas', () => {
  const html = scheduleForm({ schedule: { messageId: 'msg-a', groups: [] }, messages: MESSAGES, groups: GROUPS });
  assert.doesNotMatch(html, /name="groupList"/);
  assert.deepEqual(formGroupLists(fakeForm(html)), []);
});

test('com o WAHA fora do ar, as listas continuam disponíveis junto do campo de ids', () => {
  const html = scheduleForm({
    schedule: { messageId: 'msg-a', groups: [ALPHA], groupLists: ['lst-2'] }, messages: MESSAGES, groups: [], groupsError: 'fora', groupLists: LISTS,
  });
  assert.match(html, /name="groupList" value="lst-2" checked/);
  assert.match(html, /id="groups-text"/);
  assert.match(html, /id="groups-count">2 selecionados/);
});

test('card e modal de envio contam listas e grupos da união', () => {
  const schedule = { id: 'a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [GAMMA], groupLists: ['lst-1'], enabled: true };
  const html = scheduleList({ schedules: [schedule], messages: MESSAGES, groupLists: LISTS, groupName });
  assert.match(html, /1 lista · 3 grupos · Grupo Gamma, Grupo Alpha, Grupo Beta/);

  const modal = sendConfirm({ schedule, message: MESSAGES[0], groupName, groupLists: LISTS });
  assert.match(modal, /Enviar para 3 grupos/);
  assert.match(modal, /<li class="chip">Grupo Beta<\/li>/);
});

test('aba Grupos: vazia explica; com listas mostra grupos por nome e quem usa', () => {
  assert.match(listsView({ groupLists: [], schedules: [] }), /Crie sua primeira lista de grupos/);
  assert.equal(listsSubtitle([]), 'Nenhuma lista');
  assert.equal(listsSubtitle(LISTS), '2 listas');

  const html = listsView({
    groupLists: LISTS,
    schedules: [{ id: 'sch-a', name: 'Ofertas da manhã', groupLists: ['lst-1'] }, { id: 'sch-b', name: 'Avulso', groups: [ALPHA] }],
    groupName,
  });
  assert.match(html, /data-action="edit-list" data-id="lst-1">Ofertas SP</);
  assert.match(html, /2 grupos · Grupo Alpha, Grupo Beta/);
  assert.match(html, /Usada por Ofertas da manhã/);
  assert.match(html, /Não usada/);
  assert.match(html, /data-action="delete-list" data-id="lst-2"/);
});

test('painel de lista tem nome e os grupos, sem o bloco de listas', () => {
  const html = listForm({ list: { id: 'lst-1', name: 'Ofertas SP', groups: [ALPHA] }, groups: GROUPS });
  assert.match(html, /id="form-list"/);
  assert.match(html, /Editar lista/);
  assert.match(html, /name="name" value="Ofertas SP"/);
  assert.doesNotMatch(html, /name="groupList"/);
  const f = fakeForm(html);
  assert.deepEqual(formGroups(f), [ALPHA]);
  assert.match(listForm({ list: {}, groups: GROUPS }), /Nova lista/);
});

// ---------- App ----------

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
    schedules: [], messages: MESSAGES, groups: GROUPS, groupLists: LISTS, groupsLoaded: true, groupsError: null,
    logs: [], status: null, statusError: null, clockOffset: 0, tab: 'lists', editing: null, sending: false, ...extra,
  });
}

const routes = (extra = {}) => routedFetch({
  'GET /api/schedules': () => [200, []],
  'GET /api/messages': () => [200, MESSAGES],
  'GET /api/lists': () => [200, LISTS],
  'GET /api/status': statusBody,
  'GET /api/cron/preview': () => [200, { valid: true, next: [] }],
  ...extra,
});

test('nova lista abre o painel e salvar faz POST /api/lists com nome e grupos', async () => {
  const { fetch, calls } = routes({ 'POST /api/lists': (body) => [201, { id: 'lst-new', ...body }] });
  const $ = installDom(fetch);
  resetState();

  app.openListEditor();
  assert.match($('#drawer').innerHTML, /id="form-list"/);
  assert.equal(app.state.editing.type, 'list');

  const f = fakeForm(listForm({ list: { name: 'Nova', groups: [ALPHA, BETA] }, groups: GROUPS }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { name: 'Nova', groups: [ALPHA, BETA] });
  assert.equal(app.state.editing, null, 'o painel fecha depois de salvar');
});

test('editar lista faz PUT no id dela; erro da API aparece no painel', async () => {
  const { fetch, calls } = routes({ 'PUT /api/lists/lst-1': () => [409, { error: 'Lista "Comunidade": nome duplicado.' }] });
  const $ = installDom(fetch);
  resetState();

  app.openListEditor('lst-1');
  assert.match($('#drawer').innerHTML, /value="Ofertas SP"/);
  const f = fakeForm(listForm({ list: { id: 'lst-1', name: 'Comunidade', groups: [ALPHA] }, groups: GROUPS }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
  assert.equal($('#drawer').querySelector('.form-error').textContent, 'Lista "Comunidade": nome duplicado.');
  assert.ok(app.state.editing, 'o painel continua aberto para corrigir');
});

test('salvar agendamento manda as listas marcadas, e só lista sem grupo avulso é aceito', async () => {
  const { fetch, calls } = routes({ 'POST /api/schedules': (body) => [201, { id: 'sch-new', ...body, enabled: true }] });
  installDom(fetch);
  resetState({ tab: 'schedules' });
  app.openScheduleEditor();

  const f = fakeForm(scheduleForm({
    schedule: { name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-2'] },
    messages: MESSAGES, groups: GROUPS, groupLists: LISTS,
  }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.groupLists, ['lst-2']);
  assert.deepEqual(post.body.groups, []);
});
