# Envio único, listas de grupos e duplicar — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agendar um envio para uma data e hora únicas, reutilizar conjuntos nomeados de grupos e duplicar agendamentos e mensagens pela tela.

**Architecture:** Campos aditivos no `schedules.json` (`at`, `firedAt`, `missedAt`, `groupLists` e o cadastro `groupLists`). O agendador ganha um tique de 30 s para os envios únicos e passa a gravar `firedAt`/`missedAt` pelo store, que sai de `src/ui/` para `src/`. A tela ganha o segmento Repetir/Uma vez, a aba Grupos e os itens Duplicar.

**Tech Stack:** Node 18+ ESM, node-cron, `node:test`, tela em módulos ES sem framework, DOM falso em `test/fake-dom.js`.

**Spec:** `docs/superpowers/specs/2026-09-12-envio-unico-listas-design.md`

## Global Constraints

- Sem dependência nova além de `node-cron` e `dotenv`.
- Nomes em inglês no código; erros e logs em português, com contexto.
- Sem `console.log` solto (logger.js); JSDoc só em exports.
- Harness (`harness/`) intocado; `node harness/run.js all` verde ao final.
- Formato do arquivo continua `version: 2`; arquivos atuais seguem válidos.
- Commits pequenos por task, com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `src/store.js` compartilhado e `wallToInstant`

**Files:**
- Move: `src/ui/store.js` → `src/store.js` (atualizar imports em `src/ui/routes/*.js`, `src/ui/server.js` se houver, `test/store.test.js`)
- Create: `src/dates.js`
- Test: `test/dates.test.js`

**Interfaces:**
- Produces: `wallToInstant(wall: string, timeZone: string): number` (ms epoch; lança `Error('Data/hora inválida: "<wall>"')` para formato ou data inexistente), `isWall(value): boolean`.

- [ ] **Step 1: Mover o store**

```bash
git mv src/ui/store.js src/store.js
```

Trocar `from '../store.js'` por `from '../../store.js'` nas rotas e `from '../src/ui/store.js'` por `from '../src/store.js'` no teste. Em `src/store.js`, `import { normalizeStore } from './schedules.js'`.

- [ ] **Step 2: Teste de `wallToInstant`**

```js
// test/dates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallToInstant, isWall } from '../src/dates.js';

test('wallToInstant converte hora de parede em São Paulo (UTC-3)', () => {
  assert.equal(wallToInstant('2026-09-13T10:00', 'America/Sao_Paulo'), Date.parse('2026-09-13T13:00:00Z'));
});

test('wallToInstant respeita o horário de verão de Nova York nos dois lados da virada', () => {
  assert.equal(wallToInstant('2026-03-07T12:00', 'America/New_York'), Date.parse('2026-03-07T17:00:00Z'));
  assert.equal(wallToInstant('2026-03-09T12:00', 'America/New_York'), Date.parse('2026-03-09T16:00:00Z'));
});

test('wallToInstant recusa formato errado e data inexistente', () => {
  assert.throws(() => wallToInstant('2026-9-13 10:00', 'America/Sao_Paulo'), /Data\/hora inválida/);
  assert.throws(() => wallToInstant('2026-02-30T10:00', 'America/Sao_Paulo'), /Data\/hora inválida/);
  assert.equal(isWall('2026-09-13T10:00'), true);
  assert.equal(isWall('2026-09-13'), false);
});
```

- [ ] **Step 3: Implementar**

```js
// src/dates.js — hora de parede num fuso IANA, sem dependência.
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function offsetAt(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function isWall(value) { /* casa WALL e a data existe (mês 1-12, dia válido, hora < 24, minuto < 60) */ }

export function wallToInstant(wall, timeZone) {
  const m = typeof wall === 'string' ? wall.match(WALL) : null;
  if (!m) throw new Error(`Data/hora inválida: "${wall}". Use o formato AAAA-MM-DDTHH:MM.`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(guess).getUTCMonth() !== mo - 1 || h > 23 || mi > 59) throw new Error(`Data/hora inválida: "${wall}".`);
  let instant = guess - offsetAt(guess, timeZone);
  instant = guess - offsetAt(instant, timeZone); // segunda passada pega a virada de horário de verão
  return instant;
}
```

- [ ] **Step 4: `npm test` verde; commit** `Store compartilhado em src/ e conversão de hora de parede`

---

### Task 2: Validação de `at`, `groupLists` e destinos resolvidos

**Files:**
- Modify: `src/schedules.js`
- Test: `test/schedules.test.js`

**Interfaces:**
- Produces: `validateSchedule(raw, { defaultGroups, messageIds, listIds })` devolvendo também `at|null`, `groupLists: string[]`, `firedAt|null`, `missedAt|null`; `validateGroupList(raw, index)` → `{ id, name, groups }`; `resolveTargets(schedule, groupLists)` → `string[]` (união, avulsos primeiro); `normalizeStore` devolve `groupLists`; `loadSchedules` acrescenta `targets` em cada agendamento; `newId` exportado.

- [ ] **Step 1: Testes**

```js
test('agendamento com "at" no lugar de cron', () => {
  const s = validateSchedule({ name: 'x', at: '2026-09-13T10:00', messageId: 'm', groups: ['1@g.us'] });
  assert.equal(s.at, '2026-09-13T10:00'); assert.equal(s.cron, null);
  assert.equal(s.firedAt, null); assert.equal(s.missedAt, null);
});
test('cron e at juntos, ou nenhum, é erro', () => {
  assert.throws(() => validateSchedule({ name: 'x', cron: '0 9 * * 1', at: '2026-09-13T10:00', messageId: 'm', groups: ['1@g.us'] }), /"cron" ou "at"/);
  assert.throws(() => validateSchedule({ name: 'x', messageId: 'm', groups: ['1@g.us'] }), /"cron" ou "at"/);
});
test('at com formato errado é erro com o rótulo', () => { /* /Agendamento "x": campo "at"/ */ });
test('groupLists precisa existir e a união vem na ordem sem repetição', () => {
  const lists = [{ id: 'lst-1', name: 'A', groups: ['2@g.us', '1@g.us'] }];
  const s = validateSchedule({ name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'], groupLists: ['lst-1'] }, { listIds: new Set(['lst-1']) });
  assert.deepEqual(resolveTargets(s, lists), ['1@g.us', '2@g.us']);
  assert.throws(() => validateSchedule({ ...raw, groupLists: ['lst-x'] }, { listIds: new Set() }), /lista "lst-x" não existe/);
});
test('groups vazio com lista é válido; sem lista continua erro', () => { /* ... */ });
test('validateGroupList exige nome e ao menos um grupo; gera id lst-', () => { /* ... */ });
test('normalizeStore devolve groupLists e recusa nome de lista duplicado', () => { /* ... */ });
test('loadSchedules devolve targets resolvidos', () => { /* arquivo temporário com lista + agendamento */ });
```

- [ ] **Step 2: Implementar em `src/schedules.js`**

Em `validateSchedule`: aceitar `raw.at` (string casando `isWall`), exigir exatamente um de `cron`/`at` (`campo "cron" ou "at": informe um dos dois`), validar `groupLists` (array de strings; cada id em `listIds` quando informado), `firedAt`/`missedAt` (nulo ou `Date.parse` finito). Regra de destino: `groups` ausente e `groupLists` vazio → `defaultGroups`; `groups: []` com lista → ok. Retorno passa a incluir `cron: raw.cron?.trim() ?? null`, `at`, `groupLists`, `firedAt`, `missedAt`.

`resolveTargets(schedule, groupLists)`: `normalizeGroups([...schedule.groups, ...schedule.groupLists.flatMap((id) => byId.get(id)?.groups ?? [])])`.

`normalizeStore`: valida `groupLists` (nomes únicos) antes dos agendamentos e passa `listIds`; após montar `schedules`, confere que `resolveTargets` de cada um tem ao menos um grupo (`nenhum grupo de destino`). Devolve `{ version: 2, defaultGroups, groupLists, messages, schedules }`.

`loadSchedules`: `targets: resolveTargets(s, store.groupLists)`.

- [ ] **Step 3: Rodar `npm test` (os testes de store/rotas que usam `cron` continuam verdes porque `at` é opcional); commit** `Agendamento aceita "at" e listas de grupos; destinos resolvidos na leitura`

---

### Task 3: Tique do agendador para envios únicos

**Files:**
- Modify: `src/index.js`, `src/scheduler-status.js` (tipo do status)
- Test: `test/scheduler-oneshot.test.js`

**Interfaces:**
- Produces: `dueAction(schedule, nowMs, timeZone)` → `'wait' | 'fire' | 'missed' | 'done'` (exportada, pura); `startScheduler(options)` aceita `send` (default `broadcast`), `tickMs` (default 30 000), `now` (default `Date.now`); status ganha `oneShots: string[]`; `activeNames` inclui envios únicos pendentes.

- [ ] **Step 1: Testes**

```js
// fake send que registra chamadas; arquivo com um envio único vencido há 1 min
test('envio único vencido dispara uma vez e grava firedAt', async (t) => {
  const calls = [];
  const scheduler = startScheduler({ schedulesPath: path, tickMs: 50, send: async (...a) => { calls.push(a); return { sent: 1, failed: 0 }; }, cfg: { ...config, timezone: 'America/Sao_Paulo' } });
  t.after(() => scheduler.stop());
  await delay(200);
  assert.equal(calls.length, 1);
  assert.match(JSON.parse(readFileSync(path, 'utf8')).schedules[0].firedAt, /^\d{4}-/);
});
test('vencido há mais de 10 minutos vira missedAt sem enviar', ...);
test('envio único no futuro fica pendente e conta como ativo', ...); // activeNames inclui o nome; status.oneShots
test('dueAction: wait, fire, missed, done', ...);
```

- [ ] **Step 2: Implementar**

```js
export const TICK_MS = 30_000;
export const GRACE_MS = 600_000;

export function dueAction(schedule, nowMs, timeZone) {
  if (!schedule.at || !schedule.enabled) return 'wait';
  if (schedule.firedAt || schedule.missedAt) return 'done';
  const due = wallToInstant(schedule.at, timeZone);
  if (due > nowMs) return 'wait';
  return nowMs - due <= GRACE_MS ? 'fire' : 'missed';
}
```

Em `startScheduler`: guardar `oneShots` (agendamentos com `at`) na geração atual; `runDue()` percorre-os, e para `fire`: `await updateStore(path, (store) => { marca firedAt no id; return store })`, depois `send(item.message, item.targets, {...})` com o mesmo log de sucesso/erro do cron; para `missed`: grava `missedAt` e `warn(...)`. Um `running` evita tiques concorrentes. `beat()` inclui `oneShots: pendentes.map(n => n.name)`. `activeNames` = crons + pendentes. O tique roda uma vez no boot (depois de `register`) e a cada `tickMs` com `unref`. `reload()` recarrega os `oneShots` junto.

Atenção: o `updateStore` dispara o `fs.watch` → `reload()`; é inofensivo (recarrega o mesmo estado) mas o teste de reload não pode contar disparos repetidos: `firedAt` gravado antes do envio garante isso.

- [ ] **Step 3: `npm test`; `node harness/run.js phase3`; commit** `Agendador dispara envios únicos por tique e grava o resultado`

---

### Task 4: API de listas, `at`/`groupLists` nas rotas e status

**Files:**
- Create: `src/ui/routes/lists.js`
- Modify: `src/ui/routes/schedules.js`, `src/ui/routes/actions.js`, `src/ui/server.js` (registrar `listRoutes`)
- Test: `test/ui-lists.test.js`, `test/ui-schedules.test.js`, `test/ui-actions.test.js`

- [ ] **Step 1: Testes**

Listas: cria (201, id `lst-`), lista, edita, nome duplicado 409, `groups: []` 400, exclui 200, exclui em uso 409 com o nome do agendamento na mensagem.

Agendamentos: cria com `at` futuro (201) e `at` passado (400 `horário no futuro`); cria com `groupLists` e `groups: []`; PUT que muda `at` limpa `firedAt`; PUT que mantém `at` preserva `firedAt`. Status: `nextRuns[id]` é o instante do `at` pendente e nulo depois de `firedAt`. Run: usa a união (mock de broadcast não existe — usar `cfg.wahaUrl` apontando para um servidor local do teste que registra os `chatId`, como já faz `ui-actions.test.js`).

- [ ] **Step 2: Implementar**

`listRoutes`: `GET /api/lists`, `POST /api/lists`, `PUT /api/lists/:id`, `DELETE /api/lists/:id` (409 quando `store.schedules.some((s) => s.groupLists.includes(id))`, mensagem `A lista "<nome>" é usada por: <nomes>.`). Validação via `validateGroupList` com `status = 400`.

`scheduleRoutes`: o objeto passado a `parseSchedule` inclui `at`, `groupLists`; contexto inclui `listIds`. No POST e no PUT com `at` diferente do atual: se `wallToInstant(at, cfg.timezone) <= Date.now()` → 400 `Escolha um horário no futuro.`; ao mudar `at`, `firedAt = missedAt = null`; ao manter, copia os dois do atual. O PUT passa a receber `cfg`.

`actionRoutes`: `nextRuns` para `at` = `new Date(wallToInstant(at)).toISOString()` quando `dueAction(...) !== 'done'`, senão nulo. Run usa `resolveTargets(schedule, store.groupLists)`.

- [ ] **Step 3: `npm test`; commit** `API de listas de grupos e envio único`

---

### Task 5: Tela do envio único

**Files:**
- Modify: `public/schedules-view.js` (whenSection, scheduleCard, `formWhen`), `public/app.js` (capture, save, preview, persist), `public/style.css`
- Test: `test/ui-views.test.js`, `test/ui-app.test.js`

**Interfaces:**
- `formWhen(form)` → `{ cron: string } | { at: string }` (substitui `formCron` nos chamadores; `formCron` continua exportada e usada pela prévia).
- `whenSection(schedule, timezoneLabel)` desenha `<div class="segmented" data-role="when-mode">` com dois botões `data-action="when-repeat"` / `data-action="when-once"` (`aria-pressed`), o bloco de dias/hora (`data-role="when-repeat"`) e o bloco `data-role="when-once"` com `<input type="date" name="date">` e `<input type="time" name="onceTime">`, um `hidden` conforme o modo. `input type="hidden" name="mode"` com `repeat|once`.

- [ ] **Step 1: Testes**

Views: formulário de agendamento com `at` abre em "Uma vez" com data e hora preenchidas; `formWhen` devolve `{ at }` no modo once e `{ cron }` no repeat; card de envio único mostra "Uma vez · sáb 13/09, 10:00"; card com `firedAt` mostra badge "Enviado" e a hora; com `missedAt`, "Perdido" e "o agendador estava parado".

App: alternar o segmento troca os blocos e a prévia mostra "Uma vez: …" (sem chamar a API); salvar no modo once faz POST com `at` e sem `cron`; editar mantém `groupLists`.

- [ ] **Step 2: Implementar**

`app.js`: `captureScheduleForm` guarda `mode`, `at`, `cron`; `persistSchedule` manda `at` ou `cron` (nunca os dois) e `groupLists`; `saveSchedule` valida `at` no futuro (`wallToInstant` não existe na tela: comparar com `formatWhen`? Não: a tela só exige data e hora preenchidas; o servidor devolve o 400 "no futuro"); ações `when-repeat`/`when-once`; `updatePreview` no modo once escreve `Uma vez: ${formatWhen(...)}` calculando o instante pelo servidor? A tela não tem `wallToInstant`; usar o texto "Uma vez: 13/09/2026 às 10:00" direto dos campos, sem converter.

`scheduleCard`: `when = s.at ? 'Uma vez · ' + describeAt(s.at) : describeCron(s.cron)`; `describeAt` em `public/dates.js` → "sáb 13/09, 10:00" a partir da string de parede (sem fuso: a parede já está no fuso do agendador). Badges: `firedAt` → `badge('waiting', 'Enviado')` + meta "Enviado em <formatWhen(firedAt)>"; `missedAt` → `badge('error', 'Perdido')` + "o agendador estava parado às <hora do at>".

- [ ] **Step 3: `npm test`; commit** `Tela: envio único com data e hora`

---

### Task 6: Tela das listas de grupos

**Files:**
- Create: `public/lists-view.js`
- Modify: `public/index.html` (aba "Grupos", `<section id="lists">`), `public/schedules-view.js` (groupsSection com listas, `formGroups` devolve `{ groups, groupLists }`), `public/app.js` (state.groupLists, carga, aba, painel de lista, contador da união), `src/ui/server.js` (STATIC_FILES `/lists-view.js`), `public/style.css`
- Test: `test/ui-views.test.js`, `test/ui-app.test.js`, `test/ui-server.test.js` (estáticos já cobre por import)

**Interfaces:**
- `listsView({ groupLists, schedules, groupName })`, `listsSubtitle(groupLists)`, `listForm({ list, groups, groupsError })` em `lists-view.js`.
- `groupsSection(saved, savedLists, groups, groupLists, groupsError)`; `formGroups(form)` → `{ groups: string[], groupLists: string[] }`; `unionCount(form, groupLists)`.

- [ ] **Step 1: Testes**

Views: seção de grupos com listas mostra as listas primeiro com "Ofertas SP · 2 grupos", marca a salva, e o contador diz a união ("3 grupos selecionados" com 1 avulso + lista de 2 que inclui o avulso = 2? união = 2); aba de listas vazia explica; lista mostra "Usada por X". App: salvar lista faz POST `/lists`; excluir em uso mostra a mensagem do servidor num toast; marcar uma lista atualiza o contador.

- [ ] **Step 2: Implementar**

`app.js`: `TABS` ganha `'lists'`, `TAB_TITLES.lists = 'Grupos'`, `primaryAction` `new-list`; `load`/`reloadData` buscam `/lists`; `openListEditor(id)`; `saveList(form)`; `deleteList(id)`; ações `new-list`, `edit-list`, `delete-list`, `duplicate`? (Task 7). `handleChange` para `name="groupList"` recalcula o contador da união. `groupsText` do card: "2 listas · 14 grupos · nomes…" usando `resolveTargets` em JS (duplicar a função em `public/targets.js` ou calcular inline: união de `s.groups` + grupos das listas).

- [ ] **Step 3: `npm test`; commit** `Tela: aba Grupos com listas e seleção por lista no agendamento`

---

### Task 7: Duplicar agendamento e mensagem

**Files:**
- Modify: `public/schedules-view.js` (item de menu `duplicate`), `public/messages-view.js` (botão `duplicate-message`), `public/app.js` (`copyName`, ações), `public/html.js` (ícone `copy`: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`)
- Test: `test/ui-app.test.js`

- [ ] **Step 1: Teste**: `copyName('Promo', ['Promo'])` → `'Promo (cópia)'`; com `'Promo (cópia)'` existente → `'Promo (cópia 2)'`; ação `duplicate` abre o painel de agendamento com nome "(cópia)", sem id, mesmos grupos e listas; `duplicate-message` idem com texto e anexo (`media: { id }` mantido, ou seja, o mesmo arquivo referenciado — a API precisa aceitar `media: { id }` de OUTRA mensagem: hoje o PUT aceita `{ id }` só se for o atual; no POST, `{ id }` de uma mensagem existente deve copiar o arquivo. Ajustar `resolveMedia` em `src/ui/routes/messages.js`: `{ id }` no POST → copia o arquivo para um id novo).

- [ ] **Step 2: Implementar; `npm test`; commit** `Duplicar agendamento e mensagem`

---

### Task 8: README, harness e verificação no navegador

- [ ] README: seção "Tela de agendamentos" (Uma vez, listas, duplicar), formato do arquivo (`at`, `firedAt`, `missedAt`, `groupLists`).
- [ ] `npm test` e `node harness/run.js all` verdes.
- [ ] Navegador contra o mock (porta 3999) com a tela do worktree em 3021 e dados de teste: criar lista, criar envio único para daqui a 2 minutos com a lista, ver "Próximo envio", rodar o agendador do worktree (`npm start` com o mesmo `SCHEDULES_PATH`) e ver o card virar "Enviado" e o histórico registrar; duplicar; excluir lista em uso é recusada.
- [ ] Commit `README: envio único, listas e duplicar`.
