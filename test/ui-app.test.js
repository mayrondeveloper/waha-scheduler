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

function loadApp({ fetch } = {}) {
  const elements = new Map();
  const newElement = () => ({ textContent: '', className: '', hidden: false, innerHTML: '' });
  // Guarda os handlers que o app registra no document, para o teste poder
  // disparar um evento de mentira (ex.: "input" num campo do formulário).
  const listeners = {};

  const sandbox = {
    document: {
      querySelector: (selector) => {
        if (!elements.has(selector)) elements.set(selector, newElement());
        return elements.get(selector);
      },
      querySelectorAll: () => [],
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
    },
    // A carga inicial (load()) roda ao avaliar o arquivo: sem rede, ela
    // falha e cai no notify() do próprio app — que aqui escreve num
    // elemento de mentira. Nenhum teste depende dela.
    fetch: fetch ?? (async () => {
      throw new Error('rede desligada no teste');
    }),
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
    renderSchedules: runInContext('renderSchedules', sandbox),
    element: (selector) => sandbox.document.querySelector(selector),
    // Copia para um array deste realm: o array devolvido lá dentro tem outro
    // Array.prototype e reprovaria em assert.deepEqual (que é estrito).
    formGroups: (form) => [...formGroups(form)],
    // Resolvidas na chamada, e não aqui: uma função que ainda não existe no
    // app derruba só o teste que a usa, não o loadApp de todos.
    buildCron: (days, time) => runInContext('buildCron', sandbox)(days, time),
    parseCron: (expr) => {
      const parsed = runInContext('parseCron', sandbox)(expr);
      return parsed && { days: [...parsed.days], time: parsed.time };
    },
    describeCron: (expr) => runInContext('describeCron', sandbox)(expr),
    formCron: (form) => runInContext('formCron', sandbox)(form),
    dispatch: (type, evt) => listeners[type](evt),
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
// só o que formGroups() e formCron() consultam. É o elo que fecha a prova: o
// que o formulário desenha é exatamente o que vira payload do save.
function fakeForm(html) {
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => {
    const attr = (name) => {
      const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
      return found ? unescapeHtml(found[1]) : undefined;
    };
    return { id: attr('id'), name: attr('name'), value: attr('value') ?? '', checked: /\bchecked\b/.test(tag) };
  });

  return {
    querySelector: (selector) => {
      const byId = /^#(.+)$/.exec(selector);
      if (byId) return inputs.find((i) => i.id === byId[1]) ?? null;
      const byName = /^input\[name="([^"]+)"\]$/.exec(selector);
      return byName ? inputs.find((i) => i.name === byName[1]) ?? null : null;
    },
    querySelectorAll: (selector) => {
      const checked = /^input\[name="([^"]+)"\]:checked$/.exec(selector);
      return checked ? inputs.filter((i) => i.name === checked[1] && i.checked) : [];
    },
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

// O cron de um agendamento salvo já vem preenchido no formulário: se a prévia
// esperasse o usuário digitar, abrir "Editar" mostraria só "—".
test('abrir um agendamento salvo já mostra a prévia do cron dele', async () => {
  const requested = [];
  const app = loadApp({
    fetch: async (url) => {
      requested.push(url);
      if (!url.startsWith('/api/cron/preview')) throw new Error('rede desligada no teste');
      return { ok: true, status: 200, json: async () => ({ valid: true, next: ['2026-09-14T12:00:00.000Z'] }) };
    },
  });
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [KNOWN_GROUP]);

  app.renderSchedules();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(
    requested.includes(`/api/cron/preview?expr=${encodeURIComponent('0 9 * * 1')}`),
    'a prévia tem que ser pedida para o cron do agendamento aberto'
  );
  assert.match(
    app.element('#preview').textContent,
    /^Próximos: /,
    'a prévia tem que aparecer sem o usuário mexer no campo'
  );
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

// ---------- Dias da semana e horário no lugar do cron ----------

// fetch que responde só à prévia do cron e anota o que foi pedido.
function previewFetch(requested) {
  return async (url) => {
    requested.push(url);
    if (!url.startsWith('/api/cron/preview')) throw new Error('rede desligada no teste');
    return { ok: true, status: 200, json: async () => ({ valid: true, next: ['2026-09-14T12:00:00.000Z'] }) };
  };
}

test('dias e horário viram cron, com o domingo como 0', () => {
  const app = loadApp();
  assert.equal(app.buildCron([1, 3, 5], '09:00'), '0 9 * * 1,3,5');
  assert.equal(app.buildCron([6, 0], '18:30'), '30 18 * * 0,6');
});

test('todos os dias marcados viram "*" no dia da semana', () => {
  const app = loadApp();
  assert.equal(app.buildCron([0, 1, 2, 3, 4, 5, 6], '07:05'), '5 7 * * *');
});

test('cron de dias e horário volta para o formulário, com faixas e domingo como 7', () => {
  const app = loadApp();
  assert.deepEqual(app.parseCron('0 9 * * 1-5'), { days: [1, 2, 3, 4, 5], time: '09:00' });
  assert.deepEqual(app.parseCron('30 18 * * 7'), { days: [0], time: '18:30' });
  assert.deepEqual(app.parseCron('5 7 * * *'), { days: [0, 1, 2, 3, 4, 5, 6], time: '07:05' });
});

test('cron que não cabe em dias e horário não é convertido', () => {
  const app = loadApp();
  const custom = ['*/15 * * * *', '0 9 1 * *', '0 9 * 1 *', '0 0 9 * * 1', '0 9 * * MON', '0 9-18 * * 1', '0 24 * * 1'];
  for (const expr of custom) {
    assert.equal(app.parseCron(expr), null, `"${expr}" não pode virar dias e horário`);
  }
});

test('a lista descreve quando o agendamento dispara, com a semana começando na segunda', () => {
  const app = loadApp();
  assert.equal(app.describeCron('0 9 * * 1,3,5'), 'Seg, Qua e Sex às 09:00');
  assert.equal(app.describeCron('0 9 * * *'), 'Todo dia às 09:00');
  assert.equal(app.describeCron('5 7 * * 0'), 'Dom às 07:05');
  assert.equal(app.describeCron('0 9 * * 0,6'), 'Sáb e Dom às 09:00');
  assert.equal(app.describeCron('*/15 * * * *'), null, 'cron personalizado não tem descrição');
});

test('agendamento salvo abre com os dias marcados e o horário preenchido', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [KNOWN_GROUP]);
  app.state.editing.data.cron = '30 8 * * 1,3';

  const form = fakeForm(app.scheduleForm());

  assert.deepEqual(form.querySelectorAll('input[name="day"]:checked').map((i) => i.value), ['1', '3']);
  assert.equal(form.querySelector('input[name="time"]').value, '08:30');
  assert.equal(form.querySelector('input[name="cron"]'), null, 'cron de dias e horário não mostra o campo cru');
});

test('salvar sem mexer mantém o mesmo cron de dias e horário', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [KNOWN_GROUP]);
  app.state.editing.data.cron = '30 8 * * 1,3';

  assert.equal(app.formCron(fakeForm(app.scheduleForm())), '30 8 * * 1,3');
});

// Um cron editado à mão que não cabe em dias e horário não pode ser trocado
// por outro em silêncio só porque o usuário abriu e salvou o agendamento.
test('cron personalizado aparece como está, sinalizado, e salvar sem mexer o mantém', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [KNOWN_GROUP]);
  app.state.editing.data.cron = '*/15 * * * *';

  const html = app.scheduleForm();

  assert.match(html, /cron personalizado/i, 'o usuário tem que ver por que não há dias e horário');
  assert.equal(app.formCron(fakeForm(html)), '*/15 * * * *');
});

test('agendamento novo abre sem dia marcado e sem horário', () => {
  const app = loadApp();
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  app.state.messages = [{ id: 'msg-a', name: 'Oi' }];
  app.state.editing = { type: 'schedule', data: { messageId: 'msg-a', groups: [] } };

  const form = fakeForm(app.scheduleForm());

  assert.equal(form.querySelectorAll('input[name="day"]:checked').length, 0);
  assert.equal(form.querySelector('input[name="time"]').value, '');
  assert.equal(app.formCron(form), '', 'sem dia nem horário não sai cron');
});

test('sem nenhum dia marcado não sai cron, mesmo com horário', () => {
  const app = loadApp();
  const form = {
    querySelector: (selector) => (selector === 'input[name="time"]' ? { value: '09:00' } : null),
    querySelectorAll: () => [],
  };

  assert.equal(app.formCron(form), '');
});

test('mexer nos dias ou no horário atualiza a prévia com o cron montado', async () => {
  const requested = [];
  const app = loadApp({ fetch: previewFetch(requested) });
  app.state.groups = [{ id: KNOWN_GROUP, name: 'Grupo Alpha' }];
  editingSchedule(app, [KNOWN_GROUP]);
  app.state.editing.data.cron = '0 9 * * 1,3';
  const form = fakeForm(app.scheduleForm());

  app.dispatch('input', { target: { name: 'day', form } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(
    requested.includes(`/api/cron/preview?expr=${encodeURIComponent('0 9 * * 1,3')}`),
    'a prévia tem que ser pedida para o cron que os dias e o horário formam'
  );
});

test('a lista mostra quando dispara por extenso e o cron personalizado cru', () => {
  const app = loadApp();
  app.state.messages = [{ id: 'msg-a', name: 'Oi' }];
  app.state.schedules = [
    { id: 'a', name: 'semana', cron: '0 9 * * 1-5', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
    { id: 'b', name: 'quinze', cron: '*/15 * * * *', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
  ];

  app.renderSchedules();
  const html = app.element('#schedules').innerHTML;

  assert.match(html, /<th>Quando<\/th>/);
  assert.match(html, /Seg, Ter, Qua, Qui e Sex às 09:00/);
  assert.match(html, /<code>\*\/15 \* \* \* \*<\/code>/);
});
