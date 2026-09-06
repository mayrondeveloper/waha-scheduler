# Frontend de Agendamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma tela web local para criar, editar, ligar/desligar e excluir agendamentos e mensagens, com as alterações valendo no scheduler em execução sem reinício.

**Architecture:** Dois processos sobre um arquivo JSON compartilhado. A UI (`src/ui/server.js`, `node:http` em `127.0.0.1`) é a única que escreve, sempre via `rename()` atômico. O scheduler (`src/index.js`) apenas lê e observa o diretório com `fs.watch`, recarregando os crons quando o arquivo muda e preservando a última configuração válida se a nova for inválida.

**Tech Stack:** Node 18+, ES Modules, `node:http`, `node:fs`, `node:test`, node-cron v4, HTML/CSS/JS vanilla. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-06-frontend-agendamentos-design.md`

## Global Constraints

Copiadas do `CLAUDE.md` e do spec. Valem para **todas** as tasks.

- Node 18+, ES Modules, `fetch` nativo.
- Dependências permitidas: **apenas** `node-cron` e `dotenv`. Nenhuma nova, em nenhuma task.
- Proibidos: axios, express, TypeScript, ORM, framework de teste externo.
- Nomes de arquivos, variáveis e funções em **inglês**; mensagens de log e erros voltados ao usuário em **português**.
- Erros sempre `Error` com contexto: `Erro 500 ao enviar para 123@g.us: ...`. Nunca engolir erro em silêncio.
- Sem `console.log` solto: todo output passa por `src/logger.js`. Exceção: os CLIs em `bin/`, que imprimem resultado direto.
- JSDoc **apenas** em funções exportadas.
- Sem abstrações especulativas: funções simples exportadas por módulo, sem classes, factories ou camadas extras.
- Proibido implementar retry automático, fila ou webhook.
- **NUNCA enviar mensagem real.** Todo teste usa o mock do harness (`WAHA_URL=http://localhost:3999`).
- **Não alterar `harness/` nem o `SPEC.md`.** Se um teste do harness parecer errado, pare e pergunte ao usuário.
- Testes com `node:test`, rodados por `npm test` (`node --test test/*.test.js`).
- O servidor da UI escuta **exclusivamente** em `127.0.0.1`. Nunca `0.0.0.0`.
- Regressão obrigatória ao fim de cada task: `npm test && node harness/run.js all` — 18 checks do harness precisam continuar passando.

---

### Task 1: Mover dados do usuário para `data/`

Tira do repositório público o arquivo onde a tela vai gravar ids de grupos reais. Segue o padrão `.env`/`.env.example` que o projeto já usa.

**Files:**
- Modify: `src/config.js:36` (default de `SCHEDULES_PATH`)
- Rename: `schedules.json` → `schedules.example.json`
- Modify: `.gitignore`, `.env.example`, `README.md`
- Test: `test/config.test.js`, `test/schedules.test.js`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: `config.schedulesPath` passa a apontar para `./data/schedules.json` por default

- [ ] **Step 1: Escrever o teste que falha**

Em `test/config.test.js`, dentro do teste `'aplica defaults quando o ambiente está vazio'`, troque a asserção de `schedulesPath`:

```js
  assert.equal(cfg.schedulesPath, './data/schedules.json');
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — `Expected: './data/schedules.json'` / `Actual: './schedules.json'`

- [ ] **Step 3: Alterar o default**

Em `src/config.js`, no objeto `DEFAULTS`:

```js
  SCHEDULES_PATH: './data/schedules.json',
```

- [ ] **Step 4: Renomear o arquivo de exemplo e ajustar o teste que o lê**

```bash
git mv schedules.json schedules.example.json
```

Em `test/schedules.test.js`, no último teste, troque o nome do arquivo e o título:

```js
test('schedules.example.json do repositório é válido', () => {
  const { schedules } = loadSchedules(join(projectRoot, 'schedules.example.json'));
  assert.ok(Array.isArray(schedules));
});
```

- [ ] **Step 5: Ignorar `data/`**

Acrescente ao `.gitignore`, depois da linha `logs/`:

```
data/
```

- [ ] **Step 6: Documentar**

Em `.env.example`, troque a linha do caminho:

```
# Caminho do arquivo de agendamentos (fora do versionamento)
SCHEDULES_PATH=./data/schedules.json
```

No `README.md`, na seção **Instalação**, acrescente depois do `cp .env.example .env`:

```bash
mkdir -p data && cp schedules.example.json data/schedules.json
```

E na tabela de variáveis, mude o default de `SCHEDULES_PATH` para `./data/schedules.json`.

- [ ] **Step 7: Rodar tudo**

Run: `npm test && node harness/run.js all`
Expected: 24 testes passam, 18 checks do harness passam.

Se o harness falhar aqui, pare: ele injeta `SCHEDULES_PATH` por env em todas as fases, então não deveria ser afetado por mudança de default.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Mover agendamentos para data/, fora do versionamento"
```

---

### Task 2: Formato v2 com validação extraída

O coração do plano. Extrai as regras de validação de dentro do loader para que a API use exatamente as mesmas, e ensina o loader a ler os formatos v1 (atual) e v2 (com biblioteca de mensagens).

**Files:**
- Modify: `src/schedules.js` (arquivo inteiro, hoje 95 linhas)
- Test: `test/schedules.test.js`

**Interfaces:**
- Consumes: `normalizeGroups(groups)` de `src/broadcast.js`
- Produces:
  - `validateMessage(raw)` → `{ id, name, text }`; lança `Error` em português
  - `validateSchedule(raw, { defaultGroups, messageIds })` → `{ id, name, cron, messageId, groups, enabled }`; lança `Error`
  - `normalizeStore(parsed)` → `{ version: 2, defaultGroups, messages, schedules }`; aceita v1 e v2
  - `loadSchedules(path)` → mesma forma de antes **mais** `messages`, e cada schedule ganha `message` (texto resolvido) além de `messageId`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente em `test/schedules.test.js`:

```js
import { loadSchedules, validateMessage, validateSchedule, normalizeStore } from '../src/schedules.js';

test('validateMessage exige name e text, e gera id quando ausente', () => {
  const msg = validateMessage({ name: 'Bom dia', text: 'Olá!' });
  assert.match(msg.id, /^msg-/);
  assert.equal(msg.name, 'Bom dia');
  assert.equal(msg.text, 'Olá!');

  assert.throws(() => validateMessage({ text: 'sem nome' }), /"name" é obrigatório/);
  assert.throws(() => validateMessage({ name: 'sem texto' }), /"text" é obrigatório/);
});

test('validateSchedule recusa messageId inexistente', () => {
  assert.throws(
    () => validateSchedule(
      { name: 'x', cron: '0 9 * * 1', messageId: 'msg-nao-existe', groups: ['1@g.us'] },
      { defaultGroups: [], messageIds: new Set(['msg-existe']) }
    ),
    /mensagem "msg-nao-existe" não existe/
  );
});

test('normalizeStore converte o formato v1 para v2', () => {
  const v1 = {
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'antigo', cron: '0 9 * * 1', message: 'texto inline' }],
  };
  const store = normalizeStore(v1);

  assert.equal(store.version, 2);
  assert.equal(store.messages.length, 1);
  assert.equal(store.messages[0].text, 'texto inline');
  assert.equal(store.schedules[0].messageId, store.messages[0].id);
});

test('normalizeStore mantém v2 intacto e resolve o texto da mensagem', () => {
  const v2 = {
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'novo', cron: '0 9 * * 1', messageId: 'msg-a' }],
  };
  const store = normalizeStore(v2);

  assert.equal(store.messages.length, 1);
  assert.equal(store.schedules[0].messageId, 'msg-a');
  assert.deepEqual(store.schedules[0].groups, ['1@g.us']);
});

test('loadSchedules entrega o texto da mensagem resolvido em cada agendamento', () => {
  const path = writeSchedules({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'novo', cron: '0 9 * * 1', messageId: 'msg-a' }],
  });

  const { schedules, messages } = loadSchedules(path);
  assert.equal(messages.length, 1);
  assert.equal(schedules[0].message, 'Olá!');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — `validateMessage is not a function` (e as demais importações novas).

- [ ] **Step 3: Reescrever `src/schedules.js`**

Substitua o conteúdo inteiro:

```js
// Leitura e validação do arquivo de agendamentos (schedules.json).

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validate as isValidCron } from 'node-cron';
import { config } from './config.js';
import { normalizeGroups } from './broadcast.js';

function fail(message) {
  throw new Error(message);
}

function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * Valida e normaliza uma mensagem da biblioteca.
 * @param {Record<string, unknown>} raw Mensagem crua.
 * @returns {{id: string, name: string, text: string}}
 */
export function validateMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Mensagem: cada item de "messages" deve ser um objeto.');
  }
  const label = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '(sem nome)';

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Mensagem ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (typeof raw.text !== 'string' || !raw.text.trim()) {
    fail(`Mensagem "${label}": campo "text" é obrigatório e deve ser um texto.`);
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
    fail(`Mensagem "${label}": campo "id" deve ser um texto.`);
  }

  return {
    id: raw.id?.trim() || newId('msg'),
    name: raw.name.trim(),
    text: raw.text,
  };
}

/**
 * Valida e normaliza um agendamento.
 * @param {Record<string, unknown>} raw Agendamento cru.
 * @param {{defaultGroups?: string[], messageIds?: Set<string>}} [context]
 *   messageIds: ids válidos da biblioteca; quando informado, "messageId" é conferido.
 * @returns {{id: string, name: string, cron: string, messageId: string, groups: string[], enabled: boolean}}
 */
export function validateSchedule(raw, context = {}) {
  const { defaultGroups = [], messageIds = null } = context;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Agendamento: cada item de "schedules" deve ser um objeto.');
  }
  const label = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '(sem nome)';

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Agendamento ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (typeof raw.cron !== 'string' || !raw.cron.trim()) {
    fail(`Agendamento "${label}": campo "cron" é obrigatório e deve ser um texto.`);
  }
  if (!isValidCron(raw.cron)) {
    fail(`Agendamento "${label}": expressão cron inválida "${raw.cron}".`);
  }
  if (typeof raw.messageId !== 'string' || !raw.messageId.trim()) {
    fail(`Agendamento "${label}": campo "messageId" é obrigatório.`);
  }
  if (messageIds && !messageIds.has(raw.messageId)) {
    fail(`Agendamento "${label}": a mensagem "${raw.messageId}" não existe.`);
  }
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) {
    fail(`Agendamento "${label}": campo "groups" deve ser uma lista de ids.`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    fail(`Agendamento "${label}": campo "enabled" deve ser true ou false.`);
  }

  const groups = normalizeGroups(raw.groups?.length ? raw.groups : defaultGroups);
  if (groups.length === 0) {
    fail(`Agendamento "${label}": nenhum grupo de destino (defina "groups" ou "defaultGroups").`);
  }

  return {
    id: raw.id?.trim() || newId('sch'),
    name: raw.name.trim(),
    cron: raw.cron.trim(),
    messageId: raw.messageId,
    groups,
    enabled: raw.enabled ?? true,
  };
}

/**
 * Normaliza o conteúdo do arquivo para o formato v2, aceitando também o v1
 * (mensagem como texto dentro do agendamento).
 * @param {Record<string, unknown>} parsed Objeto já lido do JSON.
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 */
export function normalizeStore(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('Formato inválido: esperava um objeto com "schedules".');
  }
  if (parsed.defaultGroups !== undefined && !Array.isArray(parsed.defaultGroups)) {
    fail('Formato inválido: "defaultGroups" deve ser uma lista de ids.');
  }
  if (parsed.messages !== undefined && !Array.isArray(parsed.messages)) {
    fail('Formato inválido: "messages" deve ser uma lista.');
  }
  if (parsed.schedules !== undefined && !Array.isArray(parsed.schedules)) {
    fail('Formato inválido: "schedules" deve ser uma lista.');
  }

  const defaultGroups = normalizeGroups(parsed.defaultGroups ?? []);
  const messages = (parsed.messages ?? []).map(validateMessage);

  // v1: agendamento com "message" textual e sem "messageId" vira mensagem sintética.
  const rawSchedules = (parsed.schedules ?? []).map((raw) => {
    if (raw && typeof raw === 'object' && !raw.messageId && typeof raw.message === 'string') {
      const created = validateMessage({ name: raw.name ?? 'Mensagem', text: raw.message });
      messages.push(created);
      const { message, ...rest } = raw;
      return { ...rest, messageId: created.id };
    }
    return raw;
  });

  const messageIds = new Set(messages.map((m) => m.id));
  const schedules = rawSchedules.map((raw) =>
    validateSchedule(raw, { defaultGroups, messageIds })
  );

  const names = new Set();
  for (const schedule of schedules) {
    if (names.has(schedule.name)) {
      fail(`Agendamento "${schedule.name}": nome duplicado.`);
    }
    names.add(schedule.name);
  }

  return { version: 2, defaultGroups, messages, schedules };
}

/**
 * Lê e valida o arquivo de agendamentos, resolvendo o texto de cada mensagem.
 * @param {string} [path] Caminho do arquivo (default: config.schedulesPath).
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 *   Cada agendamento traz também "message" com o texto já resolvido.
 */
export function loadSchedules(path = config.schedulesPath) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler o arquivo de agendamentos ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON inválido em ${path}: ${err.message}`);
  }

  let store;
  try {
    store = normalizeStore(parsed);
  } catch (err) {
    throw new Error(`${err.message} (em ${path})`);
  }

  const textById = new Map(store.messages.map((m) => [m.id, m.text]));
  return {
    ...store,
    schedules: store.schedules.map((s) => ({ ...s, message: textById.get(s.messageId) })),
  };
}
```

- [ ] **Step 4: Ajustar os testes antigos que usavam `message` inline**

Os testes existentes de `schedules.test.js` escritos para o v1 continuam válidos como cobertura de retrocompatibilidade — o `normalizeStore` os aceita. Apenas o teste `'campos obrigatórios ausentes são recusados'` precisa do caso novo; substitua o corpo por:

```js
test('campos obrigatórios ausentes são recusados', () => {
  const semMensagem = writeSchedules({
    schedules: [{ name: 'sem-msg', cron: '0 9 * * 1', groups: ['1@g.us'] }],
  });
  assert.throws(() => loadSchedules(semMensagem), /"messageId" é obrigatório/);

  const semCron = writeSchedules({ schedules: [{ name: 'sem-cron', message: 'x' }] });
  assert.throws(() => loadSchedules(semCron), /"cron" é obrigatório/);
});
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: PASS, com os testes novos de `validateMessage`, `validateSchedule` e `normalizeStore` verdes.

- [ ] **Step 6: Ajustar `src/index.js` para o campo resolvido**

O scheduler já usa `item.message`, que agora vem resolvido do `messageId` — nenhuma mudança de código é necessária. Confirme rodando:

Run: `node harness/run.js phase3`
Expected: 4 checks passam.

Se a fase 3 falhar, é porque o harness escreve schedules no formato v1 com `message` inline — o que o `normalizeStore` aceita. Investigue antes de mudar qualquer coisa em `harness/`, que é proibido alterar.

- [ ] **Step 7: Regressão completa**

Run: `npm test && node harness/run.js all`
Expected: todos os testes e os 18 checks passam.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Formato v2 com biblioteca de mensagens e validação extraída"
```

---

### Task 3: Store com escrita atômica e fila

A camada que grava o arquivo. Escrita atômica via `rename()` para o scheduler nunca ler JSON pela metade, e uma fila de promises para duas abas não se atropelarem.

**Files:**
- Create: `src/ui/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: `normalizeStore(parsed)` e `loadSchedules(path)` de `src/schedules.js`
- Produces:
  - `readStore(path)` → objeto v2 validado (sem o campo `message` resolvido)
  - `updateStore(path, mutator)` → aplica `mutator(store)`, valida, grava atomicamente, devolve o store gravado. Escritas concorrentes são serializadas.

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStore, updateStore } from '../src/ui/store.js';

function newStorePath() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-store-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({ version: 2, defaultGroups: [], messages: [], schedules: [] }));
  return path;
}

test('readStore devolve o store normalizado', () => {
  const path = newStorePath();
  const store = readStore(path);
  assert.equal(store.version, 2);
  assert.deepEqual(store.messages, []);
});

test('updateStore grava a mutação e devolve o resultado', async () => {
  const path = newStorePath();
  const saved = await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  assert.equal(saved.messages.length, 1);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).messages[0].text, 'Olá!');
});

test('updateStore recusa mutação inválida sem tocar no arquivo', async () => {
  const path = newStorePath();
  const antes = readFileSync(path, 'utf8');

  await assert.rejects(
    () => updateStore(path, (store) => {
      store.schedules.push({ name: 'x', cron: 'inválido', messageId: 'msg-a' });
      return store;
    }),
    /cron inválida/
  );

  assert.equal(readFileSync(path, 'utf8'), antes, 'arquivo não pode mudar em erro de validação');
});

test('não deixa arquivo temporário para trás', async () => {
  const path = newStorePath();
  await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  const restos = readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(restos, [], 'nenhum .tmp pode sobrar');
});

test('escritas concorrentes são serializadas, sem perder nenhuma', async () => {
  const path = newStorePath();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateStore(path, (store) => {
        store.messages.push({ id: `msg-${i}`, name: `M${i}`, text: `texto ${i}` });
        return store;
      })
    )
  );

  const final = readStore(path);
  assert.equal(final.messages.length, 10, 'nenhuma escrita pode ser perdida');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/ui/store.js'`

- [ ] **Step 3: Implementar o store**

Crie `src/ui/store.js`:

```js
// Leitura e escrita atômica do arquivo de agendamentos, com escritas serializadas.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { normalizeStore } from '../schedules.js';

// Serializa as escritas: cada updateStore encadeia na anterior. Um processo,
// um escritor — não é lock entre processos, e o design não precisa de um.
let queue = Promise.resolve();

/**
 * Lê e valida o arquivo, devolvendo o store no formato v2.
 * @param {string} path Caminho do arquivo.
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 */
export function readStore(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON inválido em ${path}: ${err.message}`);
  }

  return normalizeStore(parsed);
}

/**
 * Aplica uma mutação ao store e grava de forma atômica. Escritas concorrentes
 * são enfileiradas, então cada mutação enxerga o resultado da anterior.
 * @param {string} path Caminho do arquivo.
 * @param {(store: object) => object} mutator Recebe o store e devolve o novo.
 * @returns {Promise<object>} O store gravado.
 */
export function updateStore(path, mutator) {
  const run = async () => {
    const current = readStore(path);
    const mutated = mutator(current);

    // Revalida o resultado da mutação: a API não pode gravar algo que o
    // scheduler recusaria no boot.
    const validated = normalizeStore(mutated);

    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      // rename() é atômico no mesmo filesystem: o scheduler nunca lê um
      // arquivo pela metade.
      renameSync(tmp, path);
    } catch (err) {
      if (existsSync(tmp)) unlinkSync(tmp);
      throw new Error(`Não foi possível gravar ${path}: ${err.message}`);
    }

    return validated;
  };

  // Encadeia mesmo em caso de falha, para um erro não travar a fila.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS, os 5 testes de store verdes.

Se `escritas concorrentes são serializadas` falhar com menos de 10 mensagens, a fila não está encadeando — confira que `queue` é reatribuída a cada chamada.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.js test/store.test.js
git commit -m "Store com escrita atômica e escritas serializadas"
```

---

### Task 4: Scheduler com watch e recarga resiliente

O scheduler passa a aplicar mudanças do arquivo sem reinício. A regra que não pode ser violada: **na recarga, config inválida preserva a anterior**; no boot, aborta.

**Files:**
- Modify: `src/index.js` (arquivo inteiro, hoje 69 linhas)
- Test: `test/scheduler-reload.test.js`

**Interfaces:**
- Consumes: `loadSchedules(path)` de `src/schedules.js`; `broadcast()` de `src/broadcast.js`
- Produces: `startScheduler({ schedulesPath, cfg })` → `{ reload(), stop(), get activeNames() }`. Exportado de `src/index.js` para poder ser testado sem subir processo.

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/scheduler-reload.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../src/index.js';

function writeConfig(path, cronDoSegundo) {
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'primeiro', cron: '0 9 * * 1', messageId: 'msg-a' },
      ...(cronDoSegundo
        ? [{ id: 'sch-b', name: 'segundo', cron: cronDoSegundo, messageId: 'msg-a' }]
        : []),
    ],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-reload-')), 'schedules.json');
}

test('reload aplica agendamento novo sem reiniciar', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['primeiro']);

  writeConfig(path, '0 10 * * 1');
  scheduler.reload();

  assert.deepEqual(scheduler.activeNames, ['primeiro', 'segundo']);
});

test('reload com config inválida preserva a anterior e não derruba', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  writeFileSync(path, '{ isso não é json }');
  const ok = scheduler.reload();

  assert.equal(ok, false, 'reload deve reportar falha');
  assert.deepEqual(scheduler.activeNames, ['primeiro'], 'config anterior preservada');
});

test('agendamento desabilitado não entra nos ativos', (t) => {
  const path = newPath();
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'ligado', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'desligado', cron: '0 9 * * 2', messageId: 'msg-a', enabled: false },
    ],
  }));

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['ligado']);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — `startScheduler is not a function`

- [ ] **Step 3: Reescrever `src/index.js`**

Substitua o conteúdo inteiro:

```js
// Processo principal: registra os agendamentos e recarrega quando o arquivo muda.

import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { schedule as scheduleCron } from 'node-cron';
import { config } from './config.js';
import { loadSchedules } from './schedules.js';
import { broadcast } from './broadcast.js';
import { info, warn, error, success } from './logger.js';

const RELOAD_DEBOUNCE_MS = 200;

/**
 * Registra os agendamentos de um arquivo e permite recarregá-los.
 * Na recarga, uma configuração inválida preserva a anterior — diferente do
 * boot, onde ela aborta o processo.
 * @param {{schedulesPath?: string, cfg?: object}} [options]
 * @returns {{reload: () => boolean, stop: () => void, activeNames: string[]}}
 */
export function startScheduler(options = {}) {
  const { schedulesPath = config.schedulesPath, cfg = config } = options;
  let tasks = [];

  function register(schedules) {
    for (const { task } of tasks) task.stop();
    tasks = [];

    for (const item of schedules) {
      if (!item.enabled) {
        warn(`Agendamento "${item.name}" está desabilitado — ignorado.`);
        continue;
      }

      const task = scheduleCron(
        item.cron,
        async () => {
          info(`Disparando agendamento "${item.name}" para ${item.groups.length} grupo(s).`);
          try {
            const { sent, failed } = await broadcast(item.message, item.groups, {
              cfg,
              label: item.name,
            });
            success(`Agendamento "${item.name}": ${sent} enviada(s), ${failed} falha(s).`);
          } catch (err) {
            error(`Agendamento "${item.name}" falhou: ${err.message}`);
          }
        },
        { timezone: cfg.timezone }
      );

      tasks.push({ name: item.name, task });
      info(`Agendamento "${item.name}" registrado: "${item.cron}" (${item.groups.length} grupo(s)).`);
    }
  }

  // Primeira carga: deixa o erro subir, para o boot poder abortar.
  register(loadSchedules(schedulesPath).schedules);

  return {
    reload() {
      let loaded;
      try {
        loaded = loadSchedules(schedulesPath);
      } catch (err) {
        error(`Recarga ignorada, mantendo a configuração anterior: ${err.message}`);
        return false;
      }
      register(loaded.schedules);
      success(`Configuração recarregada: ${tasks.length} agendamento(s) ativo(s).`);
      return true;
    },
    stop() {
      for (const { task } of tasks) task.stop();
      tasks = [];
    },
    get activeNames() {
      return tasks.map((t) => t.name);
    },
  };
}

/**
 * Observa o diretório do arquivo e chama onChange quando ele muda.
 * Observa o diretório, e não o arquivo, porque a escrita atômica troca o
 * inode e mataria um watch apontado para o arquivo.
 * @param {string} filePath Arquivo a observar.
 * @param {() => void} onChange Chamado após o debounce.
 * @returns {{close: () => void}}
 */
export function watchFile(filePath, onChange) {
  const target = resolve(filePath);
  const name = basename(target);
  let timer = null;

  const watcher = watch(dirname(target), (_event, changed) => {
    if (changed && changed !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, RELOAD_DEBOUNCE_MS);
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

// Executado apenas quando este arquivo é o entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  let scheduler;
  try {
    scheduler = startScheduler();
  } catch (err) {
    error(err.message);
    error('Corrija o arquivo de agendamentos e inicie novamente.');
    process.exit(1);
  }

  if (scheduler.activeNames.length === 0) {
    warn('Nenhum agendamento ativo. Habilite ao menos um em "schedules" para manter o serviço.');
    process.exit(0);
  }

  const watcher = watchFile(config.schedulesPath, () => scheduler.reload());

  success(
    `Scheduler no ar: ${scheduler.activeNames.length} agendamento(s) ativo(s), ` +
      `fuso ${config.timezone}, WAHA em ${config.wahaUrl}.`
  );
  info(`Observando ${config.schedulesPath} — alterações valem sem reiniciar.`);

  const shutdown = (signal) => {
    info(`Recebido ${signal}, encerrando os agendamentos.`);
    watcher.close();
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS, os 3 testes de reload verdes.

- [ ] **Step 5: Confirmar que a fase 3 do harness ainda passa**

Run: `node harness/run.js phase3`
Expected: 4 checks passam.

Atenção: a fase 3 depende do processo **abortar** com cron inválido no boot e **seguir vivo** com config válida. O bloco `import.meta.url` acima preserva os dois comportamentos. Se falhar, o problema está nesse bloco, não no harness — que é proibido alterar.

- [ ] **Step 6: Teste manual da recarga**

```bash
mkdir -p /tmp/waha-manual && cp schedules.example.json /tmp/waha-manual/schedules.json
SCHEDULES_PATH=/tmp/waha-manual/schedules.json npm start
```

Em outro terminal, edite `/tmp/waha-manual/schedules.json` (mude `enabled` para `true`) e salve. O processo deve logar `Configuração recarregada` em menos de um segundo, sem reiniciar. Encerre com Ctrl+C.

- [ ] **Step 7: Regressão completa**

Run: `npm test && node harness/run.js all`
Expected: todos os testes e os 18 checks passam.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scheduler recarrega ao detectar mudança, preservando config válida"
```

---

### Task 5: Servidor HTTP e estáticos

A base da UI: `node:http` em `127.0.0.1`, roteador simples e servir os estáticos por lista fixa — sem montar caminho a partir da URL, para não abrir travessia de diretório.

**Files:**
- Create: `src/ui/server.js`, `public/index.html`, `public/style.css`, `public/app.js`
- Modify: `src/config.js` (novas `UI_PORT` e `UI_HOST`), `package.json` (script `ui`), `.env.example`
- Test: `test/ui-server.test.js`

**Interfaces:**
- Consumes: `readStore`/`updateStore` de `src/ui/store.js`; `config` de `src/config.js`
- Produces: `createServer({ schedulesPath, cfg })` → instância `http.Server` não iniciada; `startUi({ schedulesPath, cfg })` → `Promise<{ server, port }>` já escutando

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/ui-server.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

export function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-ui-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiHost: '127.0.0.1', uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

test('serve a página e escuta só em localhost', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<title>/);
});

test('rota desconhecida responde 404 em JSON', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/nao-existe');
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

test('recusa travessia de diretório nos estáticos', async (t) => {
  const call = await boot(t, newStore());

  for (const alvo of ['/../src/config.js', '/..%2fpackage.json', '/../../etc/passwd']) {
    const res = await call(alvo);
    assert.equal(res.status, 404, `${alvo} não pode ser servido`);
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/ui/server.js'`

- [ ] **Step 3: Acrescentar as variáveis de UI ao config**

Em `src/config.js`, no `DEFAULTS`:

```js
  UI_PORT: '3000',
  UI_HOST: '127.0.0.1',
```

E no objeto devolvido por `loadConfig`, antes do fechamento:

```js
    uiPort: readNumber(env, 'UI_PORT'),
    uiHost: env.UI_HOST ?? DEFAULTS.UI_HOST,
```

- [ ] **Step 4: Implementar o servidor**

Crie `src/ui/server.js`:

```js
// Servidor HTTP local da tela de agendamentos. Escuta apenas em 127.0.0.1.

import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { info, error } from '../logger.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

// Lista fixa: o caminho servido nunca é montado a partir da URL.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Corpo da requisição grande demais.'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Cria o servidor da UI sem iniciá-lo.
 * @param {{schedulesPath?: string, cfg?: object, routes?: object}} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  const { schedulesPath = config.schedulesPath, cfg = config, routes = {} } = options;

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    const asset = STATIC_FILES[path];
    if (asset && req.method === 'GET') {
      const [file, type] = asset;
      try {
        res.writeHead(200, { 'Content-Type': type });
        return res.end(readFileSync(join(PUBLIC_DIR, file)));
      } catch (err) {
        error(`Não foi possível ler o estático ${file}: ${err.message}`);
        return sendJson(res, 500, { error: 'Erro ao carregar a página.' });
      }
    }

    // Rota exata devolve a função crua; a dinâmica devolve { fn, params }.
    // Normaliza as duas para a mesma forma antes de chamar.
    const exact = routes[`${req.method} ${path}`];
    const handler = exact ? { fn: exact, params: {} } : matchDynamic(routes, req.method, path);
    if (!handler) {
      return sendJson(res, 404, { error: `Rota não encontrada: ${req.method} ${path}` });
    }

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await handler.fn({ body, params: handler.params, url, schedulesPath, cfg });
      return sendJson(res, result.status ?? 200, result.body);
    } catch (err) {
      error(err.message);
      return sendJson(res, err.status ?? 500, { error: err.message });
    }
  });
}

// Casa rotas com um parâmetro, ex.: "DELETE /api/messages/:id".
function matchDynamic(routes, method, path) {
  for (const [key, fn] of Object.entries(routes)) {
    const [routeMethod, pattern] = key.split(' ');
    if (routeMethod !== method || !pattern.includes(':')) continue;

    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    const casou = patternParts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        return true;
      }
      return part === pathParts[i];
    });

    if (casou) return { fn, params };
  }
  return null;
}

/**
 * Cria e inicia o servidor da UI.
 * @param {{schedulesPath?: string, cfg?: object, routes?: object}} [options]
 * @returns {Promise<{server: import('node:http').Server, port: number}>}
 */
export function startUi(options = {}) {
  const cfg = options.cfg ?? config;
  const server = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Sempre 127.0.0.1: a tela dispara envios reais e não pode ser alcançável de fora.
    server.listen(cfg.uiPort, cfg.uiHost ?? '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startUi();
  info(`Tela de agendamentos em http://127.0.0.1:${port}`);
}
```

- [ ] **Step 5: Criar os estáticos mínimos**

`public/index.html` — o conteúdo real vem na Task 9; por ora, só o bastante para o teste passar:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>waha-scheduler</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

`public/style.css`:

```css
:root { color-scheme: light dark; }
body { font: 15px/1.5 system-ui, sans-serif; margin: 0; }
```

`public/app.js`:

```js
// A tela é construída na Task 9.
```

- [ ] **Step 6: Registrar o script e documentar**

Em `package.json`, nos scripts:

```json
    "ui": "node src/ui/server.js",
```

Em `.env.example`, ao final:

```
# Porta e host da tela de agendamentos (host fixo em 127.0.0.1 por segurança)
UI_PORT=3000
UI_HOST=127.0.0.1
```

- [ ] **Step 7: Rodar os testes**

Run: `npm test`
Expected: PASS, os 3 testes de servidor verdes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Servidor HTTP local da tela, com estáticos por lista fixa"
```

---

### Task 6: API de mensagens

CRUD da biblioteca, com a regra que protege os disparos: excluir mensagem em uso responde 409.

**Files:**
- Create: `src/ui/routes/messages.js`
- Modify: `src/ui/server.js` (registrar as rotas)
- Test: `test/ui-messages.test.js`

**Interfaces:**
- Consumes: `readStore`, `updateStore` de `src/ui/store.js`; `validateMessage` de `src/schedules.js`
- Produces: `messageRoutes` → objeto `{ 'GET /api/messages': fn, ... }`, no formato que `createServer` consome. Cada `fn({ body, params, schedulesPath })` devolve `{ status, body }`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/ui-messages.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-msg-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiHost: '127.0.0.1', uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('lista, cria, edita e exclui mensagem', async (t) => {
  const call = await boot(t, newStore());

  const lista = await (await call('/api/messages')).json();
  assert.equal(lista.length, 1);

  const criada = await (await call('/api/messages', json('POST', { name: 'Nova', text: 'Texto' }))).json();
  assert.match(criada.id, /^msg-/);
  assert.equal(criada.name, 'Nova');

  const editada = await (await call(`/api/messages/${criada.id}`, json('PUT', { name: 'Editada', text: 'Outro' }))).json();
  assert.equal(editada.name, 'Editada');
  assert.equal(editada.id, criada.id, 'o id não pode mudar na edição');

  const del = await call(`/api/messages/${criada.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await (await call('/api/messages')).json()).length, 1);
});

test('criar mensagem sem texto responde 400', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/messages', json('POST', { name: 'Só nome' }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /"text" é obrigatório/);
});

test('excluir mensagem em uso responde 409 e não altera nada', async (t) => {
  const path = newStore({
    schedules: [{ id: 'sch-a', name: 'usa-a-msg', cron: '0 9 * * 1', messageId: 'msg-a' }],
  });
  const call = await boot(t, path);

  const res = await call('/api/messages/msg-a', { method: 'DELETE' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /usa-a-msg/);

  assert.equal((await (await call('/api/messages')).json()).length, 1, 'mensagem preservada');
});

test('editar mensagem inexistente responde 404', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/messages/msg-fantasma', json('PUT', { name: 'x', text: 'y' }));
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — 404 nas rotas de `/api/messages`, porque ainda não existem.

- [ ] **Step 3: Implementar as rotas**

Crie `src/ui/routes/messages.js`:

```js
// Rotas HTTP da biblioteca de mensagens.

import { readStore, updateStore } from '../store.js';
import { validateMessage } from '../../schedules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Rotas da biblioteca de mensagens, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const messageRoutes = {
  'GET /api/messages': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).messages,
  }),

  'POST /api/messages': async ({ body, schedulesPath }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      // id sempre gerado no servidor: o cliente não escolhe identidade.
      created = validateMessage({ name: body.name, text: body.text });
      store.messages.push(created);
      return store;
    });
    return { status: 201, body: saved.messages.find((m) => m.id === created.id) };
  },

  'PUT /api/messages/:id': async ({ body, params, schedulesPath }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.messages.findIndex((m) => m.id === params.id);
      if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

      store.messages[index] = validateMessage({
        id: params.id,
        name: body.name,
        text: body.text,
      });
      return store;
    });
    return { body: saved.messages.find((m) => m.id === params.id) };
  },

  'DELETE /api/messages/:id': async ({ params, schedulesPath }) => {
    await updateStore(schedulesPath, (store) => {
      const index = store.messages.findIndex((m) => m.id === params.id);
      if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

      const emUso = store.schedules.filter((s) => s.messageId === params.id).map((s) => s.name);
      if (emUso.length > 0) {
        throw httpError(
          409,
          `Mensagem em uso por: ${emUso.join(', ')}. Desvincule antes de excluir.`
        );
      }

      store.messages.splice(index, 1);
      return store;
    });
    return { body: { ok: true } };
  },
};
```

- [ ] **Step 4: Fazer a validação virar 400**

Em `src/ui/server.js`, no `catch` do handler, os erros de validação (`Error` sem `status`) devem virar 400, não 500. Troque a linha do catch:

```js
    } catch (err) {
      // Erro de validação vem de validateMessage/validateSchedule sem status.
      const status = err.status ?? (/obrigatório|inválid|duplicad|não existe/i.test(err.message) ? 400 : 500);
      if (status >= 500) error(err.message);
      return sendJson(res, status, { error: err.message });
    }
```

- [ ] **Step 5: Registrar as rotas**

Em `src/ui/server.js`, importe e componha com as rotas recebidas:

```js
import { messageRoutes } from './routes/messages.js';
```

E dentro de `createServer`, troque a desestruturação de `routes`:

```js
  const { schedulesPath = config.schedulesPath, cfg = config, routes: extra = {} } = options;
  const routes = { ...messageRoutes, ...extra };
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: PASS, os 4 testes de mensagens verdes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "API de mensagens, recusando exclusão de mensagem em uso"
```

---

### Task 7: API de agendamentos

CRUD dos agendamentos mais o `PATCH` do toggle. A validação é a mesma do loader, então nada que a tela grave pode ser recusado pelo scheduler no boot.

**Files:**
- Create: `src/ui/routes/schedules.js`
- Modify: `src/ui/server.js` (compor as rotas)
- Test: `test/ui-schedules.test.js`

**Interfaces:**
- Consumes: `readStore`, `updateStore` de `src/ui/store.js`; `validateSchedule` de `src/schedules.js`
- Produces: `scheduleRoutes` no mesmo formato de `messageRoutes`

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/ui-schedules.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-sch-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiHost: '127.0.0.1', uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const novo = { name: 'bom-dia', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] };

test('cria, edita, alterna e exclui agendamento', async (t) => {
  const call = await boot(t, newStore());

  const criado = await (await call('/api/schedules', json('POST', novo))).json();
  assert.match(criado.id, /^sch-/);
  assert.equal(criado.enabled, true, 'enabled deve nascer true');

  const editado = await (await call(`/api/schedules/${criado.id}`,
    json('PUT', { ...novo, name: 'renomeado', cron: '0 10 * * 1' }))).json();
  assert.equal(editado.name, 'renomeado');
  assert.equal(editado.id, criado.id, 'renomear não pode trocar o id');

  const alternado = await (await call(`/api/schedules/${criado.id}`, json('PATCH', { enabled: false }))).json();
  assert.equal(alternado.enabled, false);
  assert.equal(alternado.name, 'renomeado', 'PATCH não pode mexer em outros campos');

  await call(`/api/schedules/${criado.id}`, { method: 'DELETE' });
  assert.deepEqual(await (await call('/api/schedules')).json(), []);
});

test('cron inválido responde 400 e não grava', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/api/schedules', json('POST', { ...novo, cron: 'não-é-cron' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /cron inválida/);

  assert.deepEqual(await (await call('/api/schedules')).json(), []);
});

test('messageId inexistente responde 400', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/schedules', json('POST', { ...novo, messageId: 'msg-fantasma' }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /não existe/);
});

test('agendamento sem groups herda defaultGroups', async (t) => {
  const call = await boot(t, newStore());
  const { groups } = await (await call('/api/schedules', json('POST', { ...novo, groups: [] }))).json();

  assert.deepEqual(groups, ['111111111111111111@g.us']);
});

test('nome duplicado responde 400', async (t) => {
  const call = await boot(t, newStore());
  await call('/api/schedules', json('POST', novo));

  const res = await call('/api/schedules', json('POST', novo));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /duplicado/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — 404 nas rotas `/api/schedules`.

- [ ] **Step 3: Implementar as rotas**

Crie `src/ui/routes/schedules.js`:

```js
// Rotas HTTP dos agendamentos.

import { readStore, updateStore } from '../store.js';
import { validateSchedule } from '../../schedules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function messageIdsOf(store) {
  return new Set(store.messages.map((m) => m.id));
}

/**
 * Rotas dos agendamentos, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const scheduleRoutes = {
  'GET /api/schedules': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).schedules,
  }),

  'POST /api/schedules': async ({ body, schedulesPath }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      created = validateSchedule(
        { name: body.name, cron: body.cron, messageId: body.messageId,
          groups: body.groups, enabled: body.enabled },
        { defaultGroups: store.defaultGroups, messageIds: messageIdsOf(store) }
      );
      store.schedules.push(created);
      return store;
    });
    return { status: 201, body: saved.schedules.find((s) => s.id === created.id) };
  },

  'PUT /api/schedules/:id': async ({ body, params, schedulesPath }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.schedules.findIndex((s) => s.id === params.id);
      if (index === -1) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      store.schedules[index] = validateSchedule(
        { id: params.id, name: body.name, cron: body.cron, messageId: body.messageId,
          groups: body.groups, enabled: body.enabled },
        { defaultGroups: store.defaultGroups, messageIds: messageIdsOf(store) }
      );
      return store;
    });
    return { body: saved.schedules.find((s) => s.id === params.id) };
  },

  'PATCH /api/schedules/:id': async ({ body, params, schedulesPath }) => {
    if (typeof body.enabled !== 'boolean') {
      throw httpError(400, 'PATCH aceita apenas o campo "enabled" (true ou false).');
    }

    const saved = await updateStore(schedulesPath, (store) => {
      const current = store.schedules.find((s) => s.id === params.id);
      if (!current) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      current.enabled = body.enabled;
      return store;
    });
    return { body: saved.schedules.find((s) => s.id === params.id) };
  },

  'DELETE /api/schedules/:id': async ({ params, schedulesPath }) => {
    await updateStore(schedulesPath, (store) => {
      const index = store.schedules.findIndex((s) => s.id === params.id);
      if (index === -1) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      store.schedules.splice(index, 1);
      return store;
    });
    return { body: { ok: true } };
  },
};
```

- [ ] **Step 4: Registrar as rotas**

Em `src/ui/server.js`:

```js
import { scheduleRoutes } from './routes/schedules.js';
```

E na composição dentro de `createServer`:

```js
  const routes = { ...messageRoutes, ...scheduleRoutes, ...extra };
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: PASS, os 5 testes de agendamentos verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "API de agendamentos com CRUD e toggle"
```

---

### Task 8: Grupos, histórico e disparo imediato

As três rotas que ligam a tela ao mundo: seletor de grupos, log de envios e o botão de disparar agora.

**Files:**
- Create: `src/ui/routes/actions.js`
- Modify: `src/ui/server.js`
- Test: `test/ui-actions.test.js`

**Interfaces:**
- Consumes: `listGroups(cfg)` de `src/waha/client.js`; `broadcast()` de `src/broadcast.js`; `readStore` de `src/ui/store.js`
- Produces: `actionRoutes` no mesmo formato das anteriores

- [ ] **Step 1: Escrever o teste que falha**

Crie `test/ui-actions.test.js`. Usa o mock do harness numa porta própria (3995), para não colidir com o harness nem com os outros arquivos de teste:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockWaha } from '../harness/mock-waha.js';
import { startUi } from '../src/ui/server.js';

const PORT = 3995;

function newStore(dir) {
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá do teste!' }],
    schedules: [{ id: 'sch-a', name: 'agora', cron: '0 9 * * 1', messageId: 'msg-a',
                  groups: ['111111111111111111@g.us'] }],
  }));
  return path;
}

async function boot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-act-'));
  const { server: mock, calls } = await startMockWaha(PORT);
  t.after(() => mock.close());

  const cfg = {
    uiHost: '127.0.0.1', uiPort: 0,
    wahaUrl: `http://localhost:${PORT}`, session: 'default', apiKey: '',
    delayMinMs: 0, delayMaxMs: 0, logPath: join(dir, 'sends.jsonl'),
  };
  const { server, port } = await startUi({ schedulesPath: newStore(dir), cfg });
  t.after(() => server.close());

  return { call: (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init), calls, cfg };
}

test('lista grupos do WAHA já normalizados', async (t) => {
  const { call } = await boot(t);
  const grupos = await (await call('/api/groups')).json();

  assert.equal(grupos.length, 3);
  assert.equal(grupos[0].id, '111111111111111111@g.us');
  assert.equal(grupos[0].name, 'Grupo Alpha');
});

test('WAHA fora do ar responde 502 sem derrubar o servidor', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-off-'));
  const cfg = { uiHost: '127.0.0.1', uiPort: 0, wahaUrl: 'http://localhost:3994',
                session: 'default', apiKey: '', logPath: join(dir, 'l.jsonl') };
  const { server, port } = await startUi({ schedulesPath: newStore(dir), cfg });
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/api/groups`);
  assert.equal(res.status, 502);

  const ok = await fetch(`http://127.0.0.1:${port}/api/schedules`);
  assert.equal(ok.status, 200, 'o servidor tem que continuar de pé');
});

test('disparar agora envia pelo mock e devolve o resumo', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-a/run', { method: 'POST' });
  assert.equal(res.status, 200);

  const resumo = await res.json();
  assert.equal(resumo.sent, 1);
  assert.equal(resumo.failed, 0);
  assert.equal(calls.length, 1, 'exatamente um envio pelo mock');
  assert.equal(calls[0].text, 'Olá do teste!');
});

test('disparar agendamento inexistente responde 404 sem enviar nada', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-fantasma/run', { method: 'POST' });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test('histórico devolve as linhas do log, mais recentes primeiro', async (t) => {
  const { call } = await boot(t);
  await call('/api/schedules/sch-a/run', { method: 'POST' });

  const logs = await (await call('/api/logs?limit=10')).json();
  assert.ok(logs.length >= 1);
  assert.equal(logs[0].status, 'sent');
  assert.equal(logs[0].chatId, '111111111111111111@g.us');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — 404 em `/api/groups`, `/api/logs` e `/api/schedules/:id/run`.

- [ ] **Step 3: Implementar as rotas**

Crie `src/ui/routes/actions.js`:

```js
// Rotas de apoio da tela: grupos do WAHA, histórico e disparo imediato.

import { readFileSync, existsSync } from 'node:fs';
import { readStore } from '../store.js';
import { listGroups } from '../../waha/client.js';
import { broadcast } from '../../broadcast.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Rotas de grupos, histórico e disparo imediato.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const actionRoutes = {
  'GET /api/groups': async ({ cfg }) => {
    try {
      return { body: await listGroups(cfg) };
    } catch (err) {
      // O WAHA estar fora do ar não é erro nosso: 502 e a tela segue utilizável.
      throw httpError(502, err.message);
    }
  },

  'GET /api/logs': async ({ url, cfg }) => {
    if (!existsSync(cfg.logPath)) return { body: [] };

    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
    const lines = readFileSync(cfg.logPath, 'utf8').trim().split('\n').filter(Boolean);

    const entries = lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();

    return { body: entries };
  },

  'POST /api/schedules/:id/run': async ({ params, schedulesPath, cfg }) => {
    const store = readStore(schedulesPath);

    const schedule = store.schedules.find((s) => s.id === params.id);
    if (!schedule) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

    const message = store.messages.find((m) => m.id === schedule.messageId);
    if (!message) throw httpError(404, `Mensagem "${schedule.messageId}" não encontrada.`);

    const { sent, failed, results } = await broadcast(message.text, schedule.groups, {
      cfg,
      label: `${schedule.name} (manual)`,
    });

    return { body: { sent, failed, results } };
  },
};
```

- [ ] **Step 4: Registrar as rotas**

Em `src/ui/server.js`:

```js
import { actionRoutes } from './routes/actions.js';
```

```js
  const routes = { ...messageRoutes, ...scheduleRoutes, ...actionRoutes, ...extra };
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: PASS, os 5 testes de ações verdes.

Confira no output que **nenhuma** chamada saiu para fora de `localhost:3995` — todo envio tem que passar pelo mock.

- [ ] **Step 6: Regressão completa**

Run: `npm test && node harness/run.js all`
Expected: todos os testes e os 18 checks passam.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Rotas de grupos, histórico e disparo imediato"
```

---

### Task 9: A tela

A interface em si. Inclui uma rota que faltou no spec: o preview do cron usa `getNextRuns()` do node-cron, que roda no servidor — o navegador não tem como calcular sozinho.

**Files:**
- Modify: `src/ui/routes/actions.js` (rota de preview), `public/index.html`, `public/style.css`, `public/app.js`
- Test: `test/ui-actions.test.js` (preview)

**Interfaces:**
- Consumes: todas as rotas das Tasks 6, 7 e 8
- Produces: `GET /api/cron/preview?expr=<cron>` → `{ valid: boolean, next: string[] }` com os 3 próximos disparos em ISO

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `test/ui-actions.test.js`:

```js
test('preview de cron devolve os próximos disparos', async (t) => {
  const { call } = await boot(t);

  const ok = await (await call('/api/cron/preview?expr=' + encodeURIComponent('0 9 * * 1'))).json();
  assert.equal(ok.valid, true);
  assert.equal(ok.next.length, 3);
  assert.ok(new Date(ok.next[0]) > new Date(), 'o primeiro disparo tem que ser no futuro');

  const ruim = await (await call('/api/cron/preview?expr=' + encodeURIComponent('não-é-cron'))).json();
  assert.equal(ruim.valid, false);
  assert.deepEqual(ruim.next, []);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FAIL — 404 em `/api/cron/preview`.

- [ ] **Step 3: Implementar a rota de preview**

Em `src/ui/routes/actions.js`, acrescente ao topo:

```js
import { schedule as scheduleCron, validate as isValidCron } from 'node-cron';
```

E acrescente a rota ao objeto `actionRoutes`:

```js
  'GET /api/cron/preview': async ({ url }) => {
    const expr = url.searchParams.get('expr') ?? '';
    if (!isValidCron(expr)) return { body: { valid: false, next: [] } };

    // Cria a task só para consultar os próximos disparos e a destrói em seguida.
    const task = scheduleCron(expr, () => {});
    try {
      const next = task.getNextRuns(3).map((d) => new Date(d).toISOString());
      return { body: { valid: true, next } };
    } finally {
      task.destroy();
    }
  },
```

- [ ] **Step 4: Rodar o teste do preview**

Run: `npm test`
Expected: PASS.

Se `getNextRuns(3)` devolver formato diferente do esperado, confira a assinatura com:
`node -e "import('node-cron').then(m=>{const t=m.schedule('0 9 * * 1',()=>{});console.log(t.getNextRuns(3));t.destroy()})"`

- [ ] **Step 5: Escrever o HTML**

Substitua `public/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>waha-scheduler</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <h1>waha-scheduler</h1>
      <nav>
        <button data-aba="agendamentos" class="ativa">Agendamentos</button>
        <button data-aba="mensagens">Mensagens</button>
        <button data-aba="historico">Histórico</button>
      </nav>
    </header>

    <p id="aviso" hidden></p>

    <main>
      <section id="agendamentos"></section>
      <section id="mensagens" hidden></section>
      <section id="historico" hidden></section>
    </main>

    <script type="module" src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Escrever o CSS**

Substitua `public/style.css`:

```css
:root {
  color-scheme: light dark;
  --borda: color-mix(in srgb, currentColor 15%, transparent);
  --erro: #c0392b;
  --ok: #1e8449;
}

body {
  font: 15px/1.5 system-ui, -apple-system, sans-serif;
  margin: 0 auto;
  max-width: 60rem;
  padding: 1.5rem;
}

header { display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; }
h1 { font-size: 1.25rem; margin: 0; }
nav { display: flex; gap: .5rem; }

nav button {
  background: none; border: 0; border-bottom: 2px solid transparent;
  cursor: pointer; font: inherit; padding: .4rem .2rem;
}
nav button.ativa { border-bottom-color: currentColor; font-weight: 600; }

#aviso { border-left: 3px solid var(--erro); margin: 1rem 0; padding: .5rem .75rem; }

table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--borda); padding: .5rem; text-align: left; }
th { font-size: .8rem; letter-spacing: .03em; text-transform: uppercase; opacity: .7; }
td.acoes { display: flex; gap: .4rem; flex-wrap: wrap; }

button, input, select, textarea { font: inherit; }
form { border: 1px solid var(--borda); border-radius: 6px; margin: 1rem 0; padding: 1rem; }
form label { display: block; margin-bottom: .75rem; }
form label span { display: block; font-size: .85rem; margin-bottom: .2rem; opacity: .75; }
form input[type="text"], form textarea, form select { box-sizing: border-box; width: 100%; }
form textarea { min-height: 5rem; }

fieldset { border: 1px solid var(--borda); border-radius: 4px; }
fieldset label { display: block; font-weight: 400; margin: 0; }

.preview { font-size: .85rem; opacity: .8; }
.preview.invalido { color: var(--erro); opacity: 1; }
.falha { color: var(--erro); }
.sucesso { color: var(--ok); }
.vazio { opacity: .7; padding: 1rem 0; }
```

- [ ] **Step 7: Escrever a tela**

Substitua `public/app.js`:

```js
// Tela de agendamentos: busca o estado da API e redesenha a cada alteração.

const estado = { schedules: [], messages: [], groups: [], logs: [], editando: null };

const $ = (sel) => document.querySelector(sel);
const escape = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function avisar(mensagem, tipo = 'erro') {
  const el = $('#aviso');
  el.textContent = mensagem;
  el.className = tipo === 'erro' ? 'falha' : 'sucesso';
  el.hidden = !mensagem;
}

async function api(caminho, init) {
  const res = await fetch(`/api${caminho}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error ?? `Erro ${res.status} em ${caminho}`);
  return corpo;
}

async function carregar() {
  avisar('');
  const [schedules, messages, logs] = await Promise.all([
    api('/schedules'),
    api('/messages'),
    api('/logs?limit=100'),
  ]);
  Object.assign(estado, { schedules, messages, logs });

  // O WAHA pode estar fora do ar: a tela continua utilizável sem a lista.
  try {
    estado.groups = await api('/groups');
  } catch (err) {
    estado.groups = [];
    avisar(`Lista de grupos indisponível: ${err.message}. Digite os ids manualmente.`);
  }

  desenhar();
}

function nomeDoGrupo(id) {
  return estado.groups.find((g) => g.id === id)?.name ?? id;
}

function desenharAgendamentos() {
  const linhas = estado.schedules.map((s) => `
    <tr>
      <td>${escape(s.name)}</td>
      <td><code>${escape(s.cron)}</code></td>
      <td>${escape(estado.messages.find((m) => m.id === s.messageId)?.name ?? '—')}</td>
      <td>${s.groups.length}</td>
      <td>
        <button data-acao="toggle" data-id="${s.id}">${s.enabled ? 'Ativo' : 'Inativo'}</button>
      </td>
      <td class="acoes">
        <button data-acao="editar" data-id="${s.id}">Editar</button>
        <button data-acao="disparar" data-id="${s.id}">Disparar agora</button>
        <button data-acao="excluir-sch" data-id="${s.id}">Excluir</button>
      </td>
    </tr>`).join('');

  $('#agendamentos').innerHTML = `
    <button data-acao="novo-sch">Novo agendamento</button>
    ${estado.editando?.tipo === 'schedule' ? formularioAgendamento() : ''}
    ${estado.schedules.length === 0
      ? '<p class="vazio">Nenhum agendamento ainda.</p>'
      : `<table>
           <tr><th>Nome</th><th>Cron</th><th>Mensagem</th><th>Grupos</th><th>Estado</th><th></th></tr>
           ${linhas}
         </table>`}`;
}

function formularioAgendamento() {
  const s = estado.editando.dados;
  const opcoes = estado.messages
    .map((m) => `<option value="${m.id}" ${m.id === s.messageId ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');

  const grupos = estado.groups.length > 0
    ? estado.groups.map((g) => `
        <label>
          <input type="checkbox" name="grupo" value="${g.id}" ${s.groups?.includes(g.id) ? 'checked' : ''} />
          ${escape(g.name)} <small>${escape(g.id)}</small>
        </label>`).join('')
    : `<input type="text" id="grupos-texto" value="${escape((s.groups ?? []).join(','))}"
              placeholder="ids separados por vírgula" />`;

  return `
    <form id="form-sch">
      <label><span>Nome</span><input type="text" name="name" value="${escape(s.name ?? '')}" required /></label>
      <label><span>Cron</span><input type="text" name="cron" value="${escape(s.cron ?? '')}" required /></label>
      <p class="preview" id="preview">—</p>
      <label><span>Mensagem</span><select name="messageId" required>${opcoes}</select></label>
      <fieldset><legend>Grupos</legend>${grupos}</fieldset>
      <button type="submit">Salvar</button>
      <button type="button" data-acao="cancelar">Cancelar</button>
    </form>`;
}

function desenharMensagens() {
  const linhas = estado.messages.map((m) => {
    const usos = estado.schedules.filter((s) => s.messageId === m.id).map((s) => s.name);
    return `
      <tr>
        <td>${escape(m.name)}</td>
        <td>${escape(m.text.slice(0, 60))}${m.text.length > 60 ? '…' : ''}</td>
        <td>${usos.length ? escape(usos.join(', ')) : '<span class="vazio">não usada</span>'}</td>
        <td class="acoes">
          <button data-acao="editar-msg" data-id="${m.id}">Editar</button>
          <button data-acao="excluir-msg" data-id="${m.id}">Excluir</button>
        </td>
      </tr>`;
  }).join('');

  const m = estado.editando?.tipo === 'message' ? estado.editando.dados : null;

  $('#mensagens').innerHTML = `
    <button data-acao="nova-msg">Nova mensagem</button>
    ${m ? `
      <form id="form-msg">
        <label><span>Nome</span><input type="text" name="name" value="${escape(m.name ?? '')}" required /></label>
        <label><span>Texto</span><textarea name="text" required>${escape(m.text ?? '')}</textarea></label>
        <button type="submit">Salvar</button>
        <button type="button" data-acao="cancelar">Cancelar</button>
      </form>` : ''}
    ${estado.messages.length === 0
      ? '<p class="vazio">Nenhuma mensagem ainda.</p>'
      : `<table><tr><th>Nome</th><th>Texto</th><th>Usada por</th><th></th></tr>${linhas}</table>`}`;
}

function desenharHistorico() {
  const linhas = estado.logs.map((l) => `
    <tr class="${l.status === 'error' ? 'falha' : ''}">
      <td>${new Date(l.ts).toLocaleString('pt-BR')}</td>
      <td>${l.status === 'error' ? 'ERRO' : 'OK'}</td>
      <td>${escape(nomeDoGrupo(l.chatId))}</td>
      <td>${escape(l.label ?? '—')}</td>
      <td>${escape(l.error ?? l.message ?? '')}</td>
    </tr>`).join('');

  $('#historico').innerHTML = estado.logs.length === 0
    ? '<p class="vazio">Nenhum envio registrado.</p>'
    : `<table><tr><th>Quando</th><th>Status</th><th>Grupo</th><th>Agendamento</th><th>Detalhe</th></tr>${linhas}</table>`;
}

function desenhar() {
  desenharAgendamentos();
  desenharMensagens();
  desenharHistorico();
}

async function atualizarPreview(expr) {
  const el = $('#preview');
  if (!el) return;

  if (!expr.trim()) {
    el.textContent = '—';
    el.className = 'preview';
    return;
  }

  const { valid, next } = await api(`/cron/preview?expr=${encodeURIComponent(expr)}`);
  el.className = valid ? 'preview' : 'preview invalido';
  if (!valid) {
    el.textContent = 'Expressão cron inválida';
  } else if (next.length === 0) {
    el.textContent = 'Nenhum disparo previsto';
  } else {
    el.textContent = `Próximos: ${next.map((d) => new Date(d).toLocaleString('pt-BR')).join(' · ')}`;
  }
}

function gruposDoFormulario(form) {
  const texto = form.querySelector('#grupos-texto');
  if (texto) return texto.value.split(',').map((g) => g.trim()).filter(Boolean);
  return [...form.querySelectorAll('input[name="grupo"]:checked')].map((i) => i.value);
}

async function comErro(fn) {
  try {
    await fn();
    avisar('');
  } catch (err) {
    avisar(err.message);
  }
}

document.addEventListener('click', (evento) => {
  const aba = evento.target.closest('nav button');
  if (aba) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('ativa', b === aba));
    ['agendamentos', 'mensagens', 'historico'].forEach((id) => {
      $(`#${id}`).hidden = id !== aba.dataset.aba;
    });
    return;
  }

  const alvo = evento.target.closest('[data-acao]');
  if (!alvo) return;
  const { acao, id } = alvo.dataset;

  const acoes = {
    'novo-sch': () => {
      estado.editando = { tipo: 'schedule', dados: { messageId: estado.messages[0]?.id, groups: [] } };
      desenhar();
    },
    editar: () => {
      estado.editando = { tipo: 'schedule', dados: estado.schedules.find((s) => s.id === id) };
      desenhar();
    },
    'nova-msg': () => {
      estado.editando = { tipo: 'message', dados: {} };
      desenhar();
    },
    'editar-msg': () => {
      estado.editando = { tipo: 'message', dados: estado.messages.find((m) => m.id === id) };
      desenhar();
    },
    cancelar: () => {
      estado.editando = null;
      desenhar();
    },
    toggle: () => comErro(async () => {
      const atual = estado.schedules.find((s) => s.id === id);
      await api(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !atual.enabled }) });
      await carregar();
    }),
    'excluir-sch': () => comErro(async () => {
      const alvo = estado.schedules.find((s) => s.id === id);
      if (!confirm(`Excluir o agendamento "${alvo.name}"?`)) return;
      await api(`/schedules/${id}`, { method: 'DELETE' });
      await carregar();
    }),
    'excluir-msg': () => comErro(async () => {
      const alvo = estado.messages.find((m) => m.id === id);
      if (!confirm(`Excluir a mensagem "${alvo.name}"?`)) return;
      await api(`/messages/${id}`, { method: 'DELETE' });
      await carregar();
    }),
    disparar: () => comErro(async () => {
      const alvo = estado.schedules.find((s) => s.id === id);
      // Com WAHA real configurado, isto envia mensagem de verdade agora.
      const texto = `Enviar "${alvo.name}" AGORA para ${alvo.groups.length} grupo(s)?\n\n`
        + 'Isso manda mensagem de verdade no WhatsApp.';
      if (!confirm(texto)) return;

      const { sent, failed } = await api(`/schedules/${id}/run`, { method: 'POST' });
      avisar(`Disparo concluído: ${sent} enviada(s), ${failed} falha(s).`, 'ok');
      await carregar();
    }),
  };

  acoes[acao]?.();
});

document.addEventListener('input', (evento) => {
  if (evento.target.name === 'cron') atualizarPreview(evento.target.value).catch(() => {});
});

document.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const form = evento.target;

  comErro(async () => {
    if (form.id === 'form-sch') {
      const dados = {
        name: form.name.value,
        cron: form.cron.value,
        messageId: form.messageId.value,
        groups: gruposDoFormulario(form),
      };
      const editandoId = estado.editando.dados.id;
      await api(editandoId ? `/schedules/${editandoId}` : '/schedules', {
        method: editandoId ? 'PUT' : 'POST',
        body: JSON.stringify(editandoId ? { ...dados, enabled: estado.editando.dados.enabled } : dados),
      });
    } else {
      const dados = { name: form.name.value, text: form.text.value };
      const editandoId = estado.editando.dados.id;
      await api(editandoId ? `/messages/${editandoId}` : '/messages', {
        method: editandoId ? 'PUT' : 'POST',
        body: JSON.stringify(dados),
      });
    }

    estado.editando = null;
    await carregar();
  });
});

carregar().catch((err) => avisar(err.message));
```

- [ ] **Step 8: Rodar os testes**

Run: `npm test`
Expected: PASS, incluindo o preview de cron.

- [ ] **Step 9: Verificar a tela no navegador**

```bash
node harness/mock-waha.js &
mkdir -p data && cp schedules.example.json data/schedules.json
WAHA_URL=http://localhost:3999 npm run ui
```

Abra `http://127.0.0.1:3000` e confirme, um a um:

1. As três abas trocam de conteúdo.
2. "Nova mensagem" cria e a mensagem aparece na tabela.
3. "Novo agendamento" lista os grupos do mock **por nome** (Grupo Alpha, Beta, Que Falha).
4. Digitar `0 9 * * 1` no campo cron mostra os próximos disparos; digitar `xyz` mostra "Expressão cron inválida".
5. O toggle Ativo/Inativo alterna e persiste após recarregar a página.
6. "Disparar agora" pede confirmação e, ao confirmar, o histórico ganha linhas.
7. Excluir uma mensagem em uso mostra o aviso de que ela está em uso, em vez de excluir.

Encerre com Ctrl+C e `pkill -f harness/mock-waha.js`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Tela de agendamentos, mensagens e histórico"
```

---

### Task 10: Integração e documentação

Fecha o ciclo: os dois processos rodando juntos, a recarga valendo de ponta a ponta, e a documentação batendo com o que foi construído.

**Files:**
- Modify: `README.md`, `package.json` (script `dev`)
- Test: verificação manual integrada

**Interfaces:**
- Consumes: tudo das Tasks 1–9
- Produces: nada de código novo

- [ ] **Step 1: Verificar o fluxo completo com os dois processos**

Em três terminais:

```bash
node harness/mock-waha.js
```

```bash
WAHA_URL=http://localhost:3999 npm start
```

```bash
WAHA_URL=http://localhost:3999 npm run ui
```

Com o `npm start` à vista, crie um agendamento pela tela usando o cron `*/20 * * * * *`.

Expected: o terminal do `npm start` loga `Configuração recarregada` em menos de um segundo **sem você reiniciá-lo**, e passa a logar `Disparando agendamento` a cada 20 segundos.

Este é o critério de aceitação central do projeto. Se a recarga não acontecer, o problema está no `watchFile` da Task 4 — investigue antes de seguir.

- [ ] **Step 2: Verificar que config inválida não derruba o scheduler**

Com o `npm start` ainda rodando, edite `data/schedules.json` à mão e quebre o JSON (apague uma chave).

Expected: o scheduler loga `Recarga ignorada, mantendo a configuração anterior` e **continua disparando**. Conserte o arquivo e confirme que ele volta a recarregar normalmente.

- [ ] **Step 3: Acrescentar o script de conveniência**

Em `package.json`, nos scripts:

```json
    "dev": "node harness/mock-waha.js & WAHA_URL=http://localhost:3999 npm run ui",
```

- [ ] **Step 4: Documentar no README**

Acrescente uma seção **Tela de agendamentos**, depois de "Rodar o agendador":

````markdown
### Tela de agendamentos

```bash
npm run ui
```

Abre em `http://127.0.0.1:3000`. Permite criar, editar, ligar/desligar e
excluir agendamentos e mensagens, escolher grupos por nome, disparar um envio
na hora e consultar o histórico.

A tela escuta **apenas em localhost** — não é alcançável pela rede local nem
pela internet, e por isso não tem senha. Para acessar de outra máquina, use um
túnel SSH:

```bash
ssh -L 3000:localhost:3000 usuario@servidor
```

O botão "disparar agora" envia mensagem de verdade quando há um WAHA real
configurado. Para experimentar sem risco, aponte para o mock:

```bash
npm run dev
```

Rodando `npm start` em paralelo, as alterações feitas na tela passam a valer
em segundos, sem reiniciar o agendador.
````

E atualize a seção **schedules.json** para o formato v2, com `messages` e
`messageId`, mencionando que o formato antigo (mensagem inline) continua sendo
lido.

- [ ] **Step 5: Atualizar a estrutura no README**

Na seção **Estrutura**, acrescente:

```
src/ui/server.js     Servidor HTTP da tela (127.0.0.1)
src/ui/store.js      Leitura e escrita atômica do schedules.json
src/ui/routes/       Rotas de mensagens, agendamentos e ações
public/              A tela (HTML, CSS e JS vanilla)
data/                Seus agendamentos (fora do versionamento)
```

- [ ] **Step 6: Regressão final**

Run: `npm test && node harness/run.js all`
Expected: todos os testes passam e os **18 checks do harness** continuam verdes.

Confirme também que nenhuma dependência foi acrescentada:

Run: `node -e "console.log(require('./package.json').dependencies)"`
Expected: exatamente `{ dotenv, node-cron }`.

- [ ] **Step 7: Confirmar que nada sensível vai para o repositório**

Run: `git status --porcelain && git check-ignore -v data/schedules.json`
Expected: `data/schedules.json` aparece como ignorado, e nenhum id de grupo real está em arquivo versionado.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Documentar a tela de agendamentos e o fluxo de recarga"
```
