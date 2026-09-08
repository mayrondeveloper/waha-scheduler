// Testes da tela (public/app.js) sem navegador: o arquivo não tem import nem
// export (é carregado por <script type="module">), então roda inteiro dentro
// de um contexto de vm com um `document` mínimo. As funções declaradas no
// topo viram propriedades do contexto; `state`, por ser `const`, é lido com
// uma segunda avaliação no MESMO contexto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const APP_SOURCE = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function loadApp() {
  const elements = new Map();
  const newElement = () => ({ textContent: '', className: '', hidden: false, innerHTML: '' });

  const sandbox = {
    document: {
      querySelector: (selector) => {
        if (!elements.has(selector)) elements.set(selector, newElement());
        return elements.get(selector);
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    // A carga inicial (load()) roda ao avaliar o arquivo: sem rede, ela
    // falha e cai no notify() do próprio app — que aqui escreve num
    // elemento de mentira. Nenhum teste depende dela.
    fetch: async () => {
      throw new Error('rede desligada no teste');
    },
    setTimeout,
    clearTimeout,
    console,
  };

  createContext(sandbox);
  runInContext(APP_SOURCE, sandbox);

  const formGroups = runInContext('formGroups', sandbox);

  return {
    state: runInContext('state', sandbox),
    scheduleForm: runInContext('scheduleForm', sandbox),
    // Copia para um array deste realm: o array devolvido lá dentro tem outro
    // Array.prototype e reprovaria em assert.deepEqual (que é estrito).
    formGroups: (form) => [...formGroups(form)],
  };
}

const unescapeHtml = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

// Form de mentira montado a partir do HTML que scheduleForm() devolveu, com
// só o que formGroups() consulta. É o elo que fecha a prova: o que o
// formulário desenha é exatamente o que vira payload do save.
function fakeForm(html) {
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  const checkedGroups = inputs
    .filter((tag) => /name="group"/.test(tag) && /\bchecked\b/.test(tag))
    .map((tag) => ({ value: unescapeHtml(/value="([^"]*)"/.exec(tag)[1]) }));

  const freeText = inputs.find((tag) => /id="groups-text"/.test(tag));

  return {
    querySelector: (selector) =>
      selector === '#groups-text' && freeText
        ? { value: unescapeHtml(/value="([^"]*)"/.exec(freeText)[1]) }
        : null,
    querySelectorAll: (selector) =>
      selector === 'input[name="group"]:checked' ? checkedGroups : [],
  };
}

const KNOWN_GROUP = '111111111111111111@g.us';
const SAVED_UNKNOWN_GROUP = '777777777777777777@g.us';

function editingSchedule(app, groups) {
  app.state.messages = [{ id: 'msg-a', name: 'Oi' }];
  app.state.schedules = [];
  app.state.editing = {
    type: 'schedule',
    data: { id: 'sch-a', name: 'bom-dia', cron: '0 9 * * 1', messageId: 'msg-a', groups },
  };
}

test('grupo salvo que o WAHA não lista aparece no formulário, marcado e sinalizado', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [SAVED_UNKNOWN_GROUP]);

  const html = app.scheduleForm();

  assert.ok(
    html.includes(`value="${SAVED_UNKNOWN_GROUP}"`),
    'o grupo salvo tem que estar no formulário mesmo fora da lista do WAHA'
  );
  assert.match(
    html,
    /não encontrado na lista atual do WAHA/,
    'o grupo fora da lista tem que estar visivelmente sinalizado'
  );
  assert.ok(html.includes(KNOWN_GROUP), 'os grupos listados pelo WAHA continuam aparecendo');
});

// O bug que este teste prende: com o grupo salvo ausente do formulário,
// formGroups() devolvia [] e a API trocava a lista vazia por defaultGroups —
// um PUT que só mudaria o nome levava a mensagem para outro grupo, calado.
test('salvar sem mexer nos grupos preserva o destino salvo que o WAHA não lista', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [SAVED_UNKNOWN_GROUP]);

  const groups = app.formGroups(fakeForm(app.scheduleForm()));

  assert.deepEqual(
    groups,
    [SAVED_UNKNOWN_GROUP],
    'o destino já salvo não pode sumir do payload só porque o WAHA não o listou'
  );
});

test('grupo listado pelo WAHA e não salvo continua desmarcado', () => {
  const app = loadApp();
  app.state.groups = [
    { id: KNOWN_GROUP, name: 'Grupo Alpha' },
    { id: '222222222222222222@g.us', name: 'Grupo Beta' },
  ];
  editingSchedule(app, [KNOWN_GROUP]);

  const groups = app.formGroups(fakeForm(app.scheduleForm()));

  assert.deepEqual(groups, [KNOWN_GROUP], 'só o grupo salvo pode vir marcado');
});

test('agendamento novo sem grupos não marca nada', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  app.state.messages = [{ id: 'msg-a', name: 'Oi' }];
  app.state.editing = { type: 'schedule', data: { messageId: 'msg-a', groups: [] } };

  assert.deepEqual(app.formGroups(fakeForm(app.scheduleForm())), []);
});

test('com o WAHA fora do ar, o campo livre já vem com os ids salvos', () => {
  const app = loadApp();
  app.state.groups = []; // GET /api/groups falhou: a tela segue utilizável
  editingSchedule(app, [SAVED_UNKNOWN_GROUP, KNOWN_GROUP]);

  const html = app.scheduleForm();
  assert.ok(html.includes('id="groups-text"'), 'sem lista do WAHA, o campo livre é a saída');

  assert.deepEqual(
    app.formGroups(fakeForm(html)),
    [SAVED_UNKNOWN_GROUP, KNOWN_GROUP],
    'os destinos salvos têm que sobreviver também quando o WAHA está fora do ar'
  );
});
