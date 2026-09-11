# Redesign da tela de agendamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a tela crua por uma com faixa de status do agendador, lista com próximo envio, painel lateral com editor de mensagem no formato do WhatsApp (formatação e emojis), modal de envio imediato e histórico agrupado por disparo.

**Architecture:** O agendador (`src/index.js`) passa a gravar um arquivo de status a cada 15 s, e a tela o lê por `GET /api/status`. O frontend vira módulos ES nativos em `public/`, sem build: lógica pura e geração de HTML em módulos importáveis pelos testes, e um `app.js` que orquestra DOM, eventos, painel e modais, iniciado por um `main.js` de duas linhas.

**Tech Stack:** Node 18+, ES Modules, `node:http`, `node:test`, node-cron v4, HTML/CSS/JS vanilla, `<dialog>` nativo. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-11-frontend-redesign-design.md`

## Global Constraints

Copiadas do `CLAUDE.md` e do spec. Valem para **todas** as tasks.

- Node 18+, ES Modules, `fetch` nativo.
- Dependências permitidas: **apenas** `node-cron` e `dotenv`. Nenhuma nova. Nada carregado de CDN, nenhuma fonte da web.
- Proibidos: axios, express, TypeScript, ORM, framework de teste externo, framework de frontend, build step.
- Nomes de arquivos, variáveis e funções em **inglês**; mensagens de log, erros e textos da tela em **português**.
- Erros sempre `Error` com contexto. Nunca engolir erro em silêncio.
- Sem `console.log` solto: todo output do servidor passa por `src/logger.js`.
- JSDoc **apenas** em funções exportadas.
- Sem abstrações especulativas: funções simples exportadas por módulo, sem classes.
- Proibido implementar retry automático, fila ou webhook.
- **NUNCA enviar mensagem real.** Testes usam mock; a verificação no navegador usa o mock do harness (`WAHA_URL=http://localhost:3999`) com `SCHEDULES_PATH` e `LOG_PATH` temporários.
- **Não alterar `harness/`.**
- Testes com `node:test`, rodados por `npm test` (`node --test test/*.test.js`). Arquivo auxiliar de teste sem `.test` no nome não roda sozinho.
- O servidor da UI escuta **exclusivamente** em `127.0.0.1`.
- Toda interpolação que vai para `innerHTML` passa por `escape()`.
- Nenhum módulo de `public/` executa nada ao ser importado, exceto `main.js`.
- Regressão obrigatória ao fim de cada task: `npm test && node harness/run.js all`.

## Mapa de arquivos

| Arquivo | Task | Responsabilidade |
|---|---|---|
| `src/scheduler-status.js` | 1 | Caminho, escrita atômica, leitura, remoção e estado do arquivo de status |
| `src/index.js` | 2 | Sinal de vida do agendador, status na recarga, remoção ao parar |
| `src/ui/routes/actions.js` | 3 | `GET /api/status` |
| `public/api.js`, `public/html.js`, `public/cron.js`, `public/dates.js` | 4 | Chamada à API, escape e ícones, cron ↔ dias/horário, datas no fuso |
| `public/whatsapp.js` | 5 | Prévia formatada e ações da barra do editor |
| `public/history.js`, `public/emoji.js` | 6 | Agrupamento do log por disparo, emojis e recentes |
| `public/status-view.js` | 7 | Faixa de status |
| `public/schedules-view.js`, `public/messages-view.js`, `public/history-view.js` | 8 | HTML das abas, do painel e dos modais |
| `public/index.html`, `public/style.css`, `public/main.js`, `public/app.js`, `src/ui/server.js` | 9 | A tela nova e a lista de estáticos |
| `README.md`, specs | 10 | Documentação |
| — | 11 | Verificação no navegador contra o mock |

Testes novos: `test/scheduler-status.test.js`, `test/scheduler-heartbeat.test.js`, `test/ui-status.test.js`, `test/ui-base.test.js`, `test/ui-cron.test.js`, `test/ui-dates.test.js`, `test/ui-whatsapp.test.js`, `test/ui-history.test.js`, `test/ui-emoji.test.js`, `test/ui-status-view.test.js`, `test/ui-views.test.js`, auxiliar `test/fake-dom.js`. Reescrito: `test/ui-app.test.js`.

---

### Task 1: Arquivo de status do agendador

**Files:**
- Create: `src/scheduler-status.js`
- Test: `test/scheduler-status.test.js`

**Interfaces:**
- Produces: `HEARTBEAT_MS = 15000`, `STALE_AFTER_MS = 45000`, `statusPathFor(schedulesPath): string`, `writeStatus(path, status): void` (lança com o caminho), `readStatus(path): object|null` (`null` só para arquivo ausente; JSON inválido lança), `removeStatus(path): void`, `schedulerState(status, now?): 'running'|'unresponsive'|'stopped'`.

- [ ] **Step 1: Escrever os testes que falham** — `test/scheduler-status.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  statusPathFor, writeStatus, readStatus, removeStatus, schedulerState, STALE_AFTER_MS,
} from '../src/scheduler-status.js';

const newDir = () => mkdtempSync(join(tmpdir(), 'waha-status-'));
const SAMPLE = {
  pid: 1,
  startedAt: '2026-09-11T12:00:00.000Z',
  beatAt: '2026-09-11T12:00:15.000Z',
  active: ['bom-dia'],
  reloadError: null,
};

test('o status fica na mesma pasta do arquivo de agendamentos', () => {
  assert.equal(statusPathFor('/x/data/schedules.json'), join('/x/data', 'scheduler-status.json'));
});

test('grava e lê o status, sem sobrar arquivo temporário', () => {
  const dir = newDir();
  const path = join(dir, 'scheduler-status.json');
  writeStatus(path, SAMPLE);
  assert.deepEqual(readStatus(path), SAMPLE);
  assert.deepEqual(readdirSync(dir), ['scheduler-status.json']);
});

test('status ausente é agendador parado, não erro', () => {
  assert.equal(readStatus(join(newDir(), 'scheduler-status.json')), null);
});

test('status corrompido lança erro com o caminho', () => {
  const path = join(newDir(), 'scheduler-status.json');
  writeFileSync(path, '{ quebrado');
  assert.throws(() => readStatus(path), /Status do agendador inválido em .*scheduler-status\.json/);
});

test('falha ao gravar lança erro com o caminho', () => {
  const path = join(newDir(), 'nao-existe', 'scheduler-status.json');
  assert.throws(() => writeStatus(path, SAMPLE), /Não foi possível gravar o status do agendador em/);
});

test('removeStatus apaga o arquivo e não reclama se ele já não existe', () => {
  const path = join(newDir(), 'scheduler-status.json');
  writeStatus(path, SAMPLE);
  removeStatus(path);
  assert.equal(existsSync(path), false);
  removeStatus(path);
});

test('estado do agendador: rodando, parou de responder, parado', () => {
  const beat = Date.parse(SAMPLE.beatAt);
  assert.equal(schedulerState(SAMPLE, beat + 1000), 'running');
  assert.equal(schedulerState(SAMPLE, beat + STALE_AFTER_MS), 'running');
  assert.equal(schedulerState(SAMPLE, beat + STALE_AFTER_MS + 1), 'unresponsive');
  assert.equal(schedulerState({ ...SAMPLE, beatAt: 'lixo' }, beat), 'unresponsive');
  assert.equal(schedulerState(null, beat), 'stopped');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/scheduler-status.test.js`
Expected: FAIL — `Cannot find module '.../src/scheduler-status.js'`

- [ ] **Step 3: Implementar** — `src/scheduler-status.js`:

```js
// Arquivo de status do agendador: é por ele que a tela sabe se os envios vão
// sair. O agendador grava; a tela só lê. Os dois processos continuam separados.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Intervalo entre dois sinais de vida do agendador, em milissegundos. */
export const HEARTBEAT_MS = 15_000;

/** Sem sinal há mais que isto, a tela considera que o agendador parou de responder. */
export const STALE_AFTER_MS = 45_000;

/**
 * Caminho do arquivo de status: a mesma pasta do arquivo de agendamentos.
 * @param {string} schedulesPath Caminho do arquivo de agendamentos.
 * @returns {string}
 */
export function statusPathFor(schedulesPath) {
  return join(dirname(schedulesPath), 'scheduler-status.json');
}

/**
 * Grava o status de forma atômica (arquivo temporário + rename): a tela
 * nunca lê um arquivo pela metade.
 * @param {string} path Caminho do arquivo de status.
 * @param {{pid: number, startedAt: string, beatAt: string, active: string[], reloadError: string|null}} status
 */
export function writeStatus(path, status) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw new Error(`Não foi possível gravar o status do agendador em ${path}: ${err.message}`);
  }
}

/**
 * Lê o status gravado pelo agendador.
 * @param {string} path Caminho do arquivo de status.
 * @returns {object|null} null quando o arquivo não existe (agendador parado).
 */
export function readStatus(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Não foi possível ler o status do agendador em ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Status do agendador inválido em ${path}: ${err.message}`);
  }
}

/**
 * Apaga o arquivo de status, se existir.
 * @param {string} path Caminho do arquivo de status.
 */
export function removeStatus(path) {
  try {
    unlinkSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new Error(`Não foi possível apagar o status do agendador em ${path}: ${err.message}`);
  }
}

/**
 * Estado do agendador a partir do status gravado.
 * @param {object|null} status Retorno de readStatus.
 * @param {number} [now] Instante de referência, em ms.
 * @returns {'running'|'unresponsive'|'stopped'}
 */
export function schedulerState(status, now = Date.now()) {
  if (!status) return 'stopped';
  const beatAt = Date.parse(status.beatAt);
  if (!Number.isFinite(beatAt) || now - beatAt > STALE_AFTER_MS) return 'unresponsive';
  return 'running';
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/scheduler-status.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add src/scheduler-status.js test/scheduler-status.test.js
git commit -m "Arquivo de status do agendador, lido pela tela"
```

---

### Task 2: Agendador grava o sinal de vida

**Files:**
- Modify: `src/index.js` (imports, `startScheduler`, bloco de entrypoint)
- Modify: `.gitignore` (status fora do versionamento em qualquer pasta)
- Test: `test/scheduler-heartbeat.test.js`

**Interfaces:**
- Consumes: `statusPathFor`, `writeStatus`, `removeStatus`, `HEARTBEAT_MS` (Task 1)
- Produces: `startScheduler({ schedulesPath?, cfg?, statusPath?, heartbeatMs? })` grava o status ao subir, a cada `heartbeatMs` e a cada recarga (`reloadError` preenchido na recusada, `null` na aceita); `stop()` apaga o arquivo.

- [ ] **Step 1: Escrever os testes que falham** — `test/scheduler-heartbeat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../src/index.js';
import { readStatus, statusPathFor } from '../src/scheduler-status.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeConfig(path, cron = '0 9 * * 1') {
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'primeiro', cron, messageId: 'msg-a' }],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-beat-')), 'schedules.json');
}

test('ao subir, o agendador grava o status ao lado do arquivo de agendamentos', (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  const status = readStatus(statusPathFor(path));
  assert.equal(status.pid, process.pid);
  assert.deepEqual(status.active, ['primeiro']);
  assert.equal(status.reloadError, null);
  assert.ok(Date.parse(status.startedAt) <= Date.parse(status.beatAt));
});

test('o sinal de vida é regravado no intervalo', async (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ schedulesPath: path, heartbeatMs: 20 });
  t.after(() => scheduler.stop());

  const first = readStatus(statusPathFor(path)).beatAt;
  await delay(80);
  assert.notEqual(readStatus(statusPathFor(path)).beatAt, first);
});

test('recarga recusada vai para o status e some na recarga seguinte', (t) => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  writeFileSync(path, '{ isso não é json }');
  scheduler.reload();
  const refused = readStatus(statusPathFor(path));
  assert.match(refused.reloadError, /JSON inválido/);
  assert.deepEqual(refused.active, ['primeiro'], 'a configuração anterior continua ativa');

  writeConfig(path, '0 10 * * 1');
  scheduler.reload();
  assert.equal(readStatus(statusPathFor(path)).reloadError, null);
});

test('stop apaga o status', () => {
  const path = newPath();
  writeConfig(path);
  const scheduler = startScheduler({ schedulesPath: path });
  scheduler.stop();
  assert.equal(existsSync(statusPathFor(path)), false);
});

test('falha ao gravar o status não derruba o agendador', (t) => {
  const path = newPath();
  writeConfig(path);
  // Um arquivo no lugar da pasta: toda gravação do status falha.
  const scheduler = startScheduler({ schedulesPath: path, statusPath: join(path, 'status.json') });
  t.after(() => scheduler.stop());
  assert.deepEqual(scheduler.activeNames, ['primeiro']);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/scheduler-heartbeat.test.js`
Expected: FAIL — `readStatus` devolve `null` (`Cannot read properties of null (reading 'pid')`)

- [ ] **Step 3: Implementar em `src/index.js`**

Acrescente o import, depois de `import { info, warn, error, success } from './logger.js';`:

```js
import { statusPathFor, writeStatus, removeStatus, HEARTBEAT_MS } from './scheduler-status.js';
```

Troque o JSDoc e o começo de `startScheduler` (até `let tasks = [];`) por:

```js
/**
 * Registra os agendamentos de um arquivo e permite recarregá-los.
 * Na recarga, uma configuração inválida preserva a anterior — diferente do
 * boot, onde ela aborta o processo. Enquanto roda, grava o arquivo de status
 * que a tela lê para saber se os envios vão sair.
 * @param {{schedulesPath?: string, cfg?: object, statusPath?: string, heartbeatMs?: number}} [options]
 * @returns {{reload: () => boolean, stop: () => void, activeNames: string[]}}
 */
export function startScheduler(options = {}) {
  const {
    schedulesPath = config.schedulesPath,
    cfg = config,
    statusPath = statusPathFor(schedulesPath),
    heartbeatMs = HEARTBEAT_MS,
  } = options;
  let tasks = [];
  const startedAt = new Date().toISOString();
  let reloadError = null;
  let statusFailing = false;

  // Status é informação para a tela, nunca motivo para derrubar o
  // agendador: a falha ao gravar é logada uma vez e os disparos seguem.
  function beat() {
    try {
      writeStatus(statusPath, {
        pid: process.pid,
        startedAt,
        beatAt: new Date().toISOString(),
        active: tasks.map((t) => t.name),
        reloadError,
      });
      if (statusFailing) info(`Status do agendador voltou a ser gravado em ${statusPath}.`);
      statusFailing = false;
    } catch (err) {
      if (!statusFailing) error(`${err.message}. Os agendamentos continuam disparando.`);
      statusFailing = true;
    }
  }
```

Troque o trecho da primeira carga e o objeto devolvido (de `// Primeira carga: deixa o erro subir, para o boot poder abortar.` até o `};` final da função) por:

```js
  // Primeira carga: deixa o erro subir, para o boot poder abortar.
  register(loadSchedules(schedulesPath).schedules);
  beat();
  // unref: o timer sozinho não mantém o processo vivo — quem mantém são os
  // crons e o watcher do arquivo.
  const heartbeat = setInterval(beat, heartbeatMs);
  heartbeat.unref();

  return {
    reload() {
      try {
        const loaded = loadSchedules(schedulesPath);
        register(loaded.schedules);
      } catch (err) {
        error(`Recarga ignorada, mantendo a configuração anterior: ${err.message}`);
        reloadError = err.message;
        beat();
        return false;
      }
      reloadError = null;
      beat();
      success(`Configuração recarregada: ${tasks.length} agendamento(s) ativo(s).`);
      return true;
    },
    stop() {
      clearInterval(heartbeat);
      for (const { task } of tasks) task.destroy();
      tasks = [];
      try {
        removeStatus(statusPath);
      } catch (err) {
        error(err.message);
      }
    },
    get activeNames() {
      return tasks.map((t) => t.name);
    },
  };
}
```

No entrypoint, o encerramento sem agendamento ativo passa a apagar o status:

```js
  if (scheduler.activeNames.length === 0) {
    warn('Nenhum agendamento ativo. Habilite ao menos um em "schedules" para manter o serviço.');
    scheduler.stop();
    process.exit(0);
  }
```

Em `.gitignore`, depois da linha `/schedules.json`, acrescente:

```
# Status que o agendador grava ao lado do arquivo de agendamentos — em data/
# ele já fica de fora, mas SCHEDULES_PATH pode apontar para outra pasta.
scheduler-status.json
scheduler-status.json.tmp
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/scheduler-heartbeat.test.js test/scheduler-reload.test.js`
Expected: PASS (5 novos + os de recarga existentes)

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add src/index.js .gitignore test/scheduler-heartbeat.test.js
git commit -m "Agendador grava o sinal de vida que a tela lê"
```

---

### Task 3: `GET /api/status`

**Files:**
- Modify: `src/ui/routes/actions.js`
- Test: `test/ui-status.test.js`

**Interfaces:**
- Consumes: `statusPathFor`, `readStatus`, `schedulerState` (Task 1)
- Produces: `GET /api/status` → `{ now, timezone, timezoneLabel, scheduler: { state, startedAt, beatAt, reloadError }, nextRuns: { [scheduleId]: iso|null } }`; `nextRuns` só tem chave para agendamento ativo. Status ilegível é logado e conta como `stopped`.

- [ ] **Step 1: Escrever os testes que falham** — `test/ui-status.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';
import { writeStatus, statusPathFor } from '../src/scheduler-status.js';

function newStore() {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-status-ui-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'segunda', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'pausado', cron: '0 9 * * 2', messageId: 'msg-a', enabled: false },
    ],
  }));
  return path;
}

async function fetchStatus(t, schedulesPath) {
  const cfg = { uiPort: 0, timezone: 'America/Sao_Paulo', logPath: join(tmpdir(), 'nao-usado.jsonl') };
  const { server, port } = await startUi({ schedulesPath, cfg });
  t.after(() => server.close());
  return (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
}

const beating = (extra = {}) => ({
  pid: 1,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  beatAt: new Date().toISOString(),
  active: ['segunda'],
  reloadError: null,
  ...extra,
});

test('sem arquivo de status, o agendador está parado', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.equal(status.scheduler.state, 'stopped');
  assert.equal(status.scheduler.beatAt, null);
});

test('com sinal de vida recente, o agendador está rodando', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating());
  assert.equal((await fetchStatus(t, path)).scheduler.state, 'running');
});

test('sinal de vida antigo é agendador que parou de responder', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating({ beatAt: new Date(Date.now() - 120_000).toISOString() }));
  const status = await fetchStatus(t, path);
  assert.equal(status.scheduler.state, 'unresponsive');
  assert.ok(status.scheduler.beatAt);
});

test('recarga recusada chega à tela', async (t) => {
  const path = newStore();
  writeStatus(statusPathFor(path), beating({ reloadError: 'JSON inválido' }));
  assert.equal((await fetchStatus(t, path)).scheduler.reloadError, 'JSON inválido');
});

test('status corrompido conta como parado, sem 500', async (t) => {
  const path = newStore();
  writeFileSync(statusPathFor(path), '{ quebrado');
  assert.equal((await fetchStatus(t, path)).scheduler.state, 'stopped');
});

test('devolve o fuso configurado, o nome dele e o relógio do servidor', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.equal(status.timezone, 'America/Sao_Paulo');
  assert.equal(status.timezoneLabel, 'Horário Padrão de Brasília');
  assert.ok(Math.abs(Date.parse(status.now) - Date.now()) < 5000);
});

test('próximo envio só dos ativos, calculado no fuso configurado', async (t) => {
  const status = await fetchStatus(t, newStore());
  assert.deepEqual(Object.keys(status.nextRuns), ['sch-a']);
  // "0 9 * * 1" em São Paulo (UTC-3, sem horário de verão) é segunda às 12:00 UTC.
  const next = new Date(status.nextRuns['sch-a']);
  assert.equal(next.getUTCDay(), 1);
  assert.equal(next.getUTCHours(), 12);
  assert.equal(next.getUTCMinutes(), 0);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-status.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'state')` (a rota ainda responde 404)

- [ ] **Step 3: Implementar em `src/ui/routes/actions.js`**

Troque o comentário de topo e acrescente os imports:

```js
// Rotas de apoio da tela: grupos do WAHA, histórico, disparo imediato,
// prévia de cron e status do agendador.

import { readFileSync, existsSync } from 'node:fs';
import { schedule as scheduleCron } from 'node-cron';
import { readStore } from '../store.js';
import { checkCron } from '../../schedules.js';
import { listGroups } from '../../waha/client.js';
import { broadcast } from '../../broadcast.js';
import { statusPathFor, readStatus, schedulerState } from '../../scheduler-status.js';
import { error } from '../../logger.js';
```

Depois de `httpError`, acrescente:

```js
// Próximo disparo no fuso do agendador, pela mesma técnica do preview: cria a
// task só para consultar e a destrói em seguida.
function nextRunOf(expr, timezone) {
  const task = scheduleCron(expr, () => {}, { timezone });
  try {
    const [next] = task.getNextRuns(1);
    return next ? new Date(next).toISOString() : null;
  } finally {
    task.destroy();
  }
}

function timezoneLabel(timeZone) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone, timeZoneName: 'long' }).formatToParts(new Date());
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}
```

No objeto `actionRoutes`, depois de `'GET /api/cron/preview'`, acrescente:

```js
  'GET /api/status': async ({ schedulesPath, cfg }) => {
    const now = Date.now();

    // Status ilegível conta como parado para a tela, mas nunca em silêncio:
    // o log do servidor da tela diz o que houve com o arquivo.
    let status = null;
    try {
      status = readStatus(statusPathFor(schedulesPath));
    } catch (err) {
      error(`${err.message}. A tela vai mostrar o agendador como parado.`);
    }

    const nextRuns = {};
    for (const schedule of readStore(schedulesPath).schedules) {
      if (!schedule.enabled) continue;
      try {
        nextRuns[schedule.id] = nextRunOf(schedule.cron, cfg.timezone);
      } catch (err) {
        error(`Não foi possível calcular o próximo envio de "${schedule.name}": ${err.message}`);
        nextRuns[schedule.id] = null;
      }
    }

    return {
      body: {
        now: new Date(now).toISOString(),
        timezone: cfg.timezone,
        timezoneLabel: timezoneLabel(cfg.timezone),
        scheduler: {
          state: schedulerState(status, now),
          startedAt: status?.startedAt ?? null,
          beatAt: status?.beatAt ?? null,
          reloadError: status?.reloadError ?? null,
        },
        nextRuns,
      },
    };
  },
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-status.test.js test/ui-actions.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add src/ui/routes/actions.js test/ui-status.test.js
git commit -m "Rota de status: agendador, fuso e próximo envio de cada agendamento"
```

---

### Task 4: Módulos base da tela

Criados ao lado do `app.js` atual, que continua funcionando até a Task 9. Os testes antigos de `test/ui-app.test.js` ficam como estão até lá.

**Files:**
- Create: `public/api.js`, `public/html.js`, `public/cron.js`, `public/dates.js`
- Test: `test/ui-base.test.js`, `test/ui-cron.test.js`, `test/ui-dates.test.js`

**Interfaces:**
- Produces:
  - `api(path, init?): Promise<any>` — `fetch('/api' + path)`, `Content-Type: application/json` em POST/PUT/PATCH/DELETE, lança `Error(body.error ?? 'Erro <status> em <path>')`.
  - `escape(value): string`, `icon(name): string` (lança para nome desconhecido). Nomes: `alert, bold, check, chevronDown, circleCheck, clock, code, ellipsis, italic, list, listOrdered, pencil, plus, quote, send, smile, strikethrough, trash, x`.
  - `WEEKDAYS`, `buildCron(days, time)`, `parseCron(expr)`, `describeCron(expr)` — mesmo comportamento do `app.js` atual.
  - `formatWhen(when, { timeZone?, now? }): string` e `formatTime(when, { timeZone?, seconds? }): string`.

- [ ] **Step 1: Escrever os testes que falham**

`test/ui-base.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../public/api.js';
import { escape, icon } from '../public/html.js';

function withFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}

test('api manda Content-Type JSON em todo método que altera dados, mesmo sem corpo', async (t) => {
  const seen = [];
  withFetch(t, async (url, init) => {
    seen.push([url, init?.headers?.['Content-Type']]);
    return { ok: true, status: 200, json: async () => ({}) };
  });
  await api('/schedules/sch-a', { method: 'DELETE' });
  await api('/schedules/sch-a/run', { method: 'POST' });
  await api('/schedules');
  assert.deepEqual(seen, [
    ['/api/schedules/sch-a', 'application/json'],
    ['/api/schedules/sch-a/run', 'application/json'],
    ['/api/schedules', undefined],
  ]);
});

test('api lança o erro em português que o servidor mandou', async (t) => {
  withFetch(t, async () => ({ ok: false, status: 409, json: async () => ({ error: 'Mensagem em uso por: bom-dia.' }) }));
  await assert.rejects(api('/messages/msg-a', { method: 'DELETE' }), /Mensagem em uso por: bom-dia\./);
});

test('api sem corpo de erro diz o status e o caminho', async (t) => {
  withFetch(t, async () => ({ ok: false, status: 502, json: async () => { throw new Error('não é JSON'); } }));
  await assert.rejects(api('/groups'), /Erro 502 em \/groups/);
});

test('escape neutraliza aspas e sinais de HTML', () => {
  assert.equal(escape(`"><img src=x onerror='1'>&`), '&quot;&gt;&lt;img src=x onerror=&#39;1&#39;&gt;&amp;');
});

test('ícone é SVG decorativo; nome desconhecido é erro', () => {
  assert.match(icon('plus'), /^<svg class="icon"[^>]*aria-hidden="true"/);
  assert.throws(() => icon('nao-existe'), /Ícone desconhecido: "nao-existe"/);
});
```

`test/ui-cron.test.js` (os asserts de cron que hoje estão em `test/ui-app.test.js`, agora por import):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCron, parseCron, describeCron } from '../public/cron.js';

test('dias e horário viram cron, com o domingo como 0', () => {
  assert.equal(buildCron([1, 3, 5], '09:00'), '0 9 * * 1,3,5');
  assert.equal(buildCron([6, 0], '18:30'), '30 18 * * 0,6');
});

test('todos os dias marcados viram "*" no dia da semana', () => {
  assert.equal(buildCron([0, 1, 2, 3, 4, 5, 6], '07:05'), '5 7 * * *');
});

test('cron de dias e horário volta para o formulário, com faixas e domingo como 7', () => {
  assert.deepEqual(parseCron('0 9 * * 1-5'), { days: [1, 2, 3, 4, 5], time: '09:00' });
  assert.deepEqual(parseCron('30 18 * * 7'), { days: [0], time: '18:30' });
  assert.deepEqual(parseCron('5 7 * * *'), { days: [0, 1, 2, 3, 4, 5, 6], time: '07:05' });
});

test('cron que não cabe em dias e horário não é convertido', () => {
  const custom = ['*/15 * * * *', '0 9 1 * *', '0 9 * 1 *', '0 0 9 * * 1', '0 9 * * MON', '0 9-18 * * 1', '0 24 * * 1'];
  for (const expr of custom) {
    assert.equal(parseCron(expr), null, `"${expr}" não pode virar dias e horário`);
  }
});

test('a lista descreve quando o agendamento dispara, com a semana começando na segunda', () => {
  assert.equal(describeCron('0 9 * * 1,3,5'), 'Seg, Qua e Sex às 09:00');
  assert.equal(describeCron('0 9 * * *'), 'Todo dia às 09:00');
  assert.equal(describeCron('5 7 * * 0'), 'Dom às 07:05');
  assert.equal(describeCron('0 9 * * 0,6'), 'Sáb e Dom às 09:00');
  assert.equal(describeCron('*/15 * * * *'), null, 'cron personalizado não tem descrição');
});
```

`test/ui-dates.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatWhen, formatTime } from '../public/dates.js';

const SP = { timeZone: 'America/Sao_Paulo' };
// Sexta, 11/09/2026, 15:00 em São Paulo (18:00 UTC).
const NOW = Date.parse('2026-09-11T18:00:00Z');

test('mesmo dia, dia seguinte e dia anterior no fuso configurado', () => {
  assert.equal(formatWhen('2026-09-11T21:00:00Z', { ...SP, now: NOW }), 'hoje, 18:00');
  assert.equal(formatWhen('2026-09-12T12:00:00Z', { ...SP, now: NOW }), 'amanhã, 09:00');
  assert.equal(formatWhen('2026-09-11T02:39:00Z', { ...SP, now: NOW }), 'ontem, 23:39');
});

test('o dia vira no fuso configurado, não em UTC', () => {
  // 02:42 UTC do dia 11 ainda é dia 10 em São Paulo, e "agora" também.
  const now = Date.parse('2026-09-11T02:00:00Z');
  assert.equal(formatWhen('2026-09-11T02:42:00Z', { ...SP, now }), 'hoje, 23:42');
});

test('outros dias mostram o dia da semana; outro ano mostra o ano', () => {
  assert.equal(formatWhen('2026-09-18T21:00:00Z', { ...SP, now: NOW }), 'sex 18/09, 18:00');
  assert.equal(formatWhen('2026-09-14T12:00:00Z', { ...SP, now: NOW }), 'seg 14/09, 09:00');
  assert.equal(formatWhen('2025-09-18T21:00:00Z', { ...SP, now: NOW }), '18/09/2025, 18:00');
});

test('meia-noite sai como 00:00 e o horário pode ter segundos', () => {
  assert.equal(formatTime('2026-09-12T03:00:00Z', SP), '00:00');
  assert.equal(formatTime('2026-09-11T12:00:08Z', { ...SP, seconds: true }), '09:00:08');
});

test('o resultado não depende do fuso do processo', () => {
  const module = new URL('../public/dates.js', import.meta.url).href;
  const script = `import { formatWhen } from ${JSON.stringify(module)};
    process.stdout.write(formatWhen('2026-09-11T02:42:00Z',
      { timeZone: 'America/Sao_Paulo', now: Date.parse('2026-09-11T02:00:00Z') }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'UTC' },
  }).toString();
  assert.equal(out, 'hoje, 23:42');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-base.test.js test/ui-cron.test.js test/ui-dates.test.js`
Expected: FAIL — `Cannot find module '.../public/api.js'` (e os demais)

- [ ] **Step 3: Implementar**

`public/api.js`:

```js
// Chamadas à API da tela, com o cabeçalho que o servidor exige.

// Métodos que o servidor considera mutantes: exige Content-Type:
// application/json em TODOS eles, mesmo sem corpo (DELETE e POST /run não têm
// corpo e ainda assim precisam do cabeçalho, ou o servidor devolve 415).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Chama a API da tela e devolve o corpo JSON.
 * @param {string} path Caminho depois de /api, ex.: "/schedules".
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function api(path, init) {
  const method = (init?.method ?? 'GET').toUpperCase();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: MUTATING_METHODS.has(method) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status} em ${path}`);
  return body;
}
```

`public/html.js`:

```js
// Escape de HTML e ícones da tela. Sem DOM: importável pelos testes.

/**
 * Escapa um valor para entrar em HTML, tanto em conteúdo quanto em atributo.
 * TODA interpolação que vai para innerHTML passa por aqui — inclusive ids
 * vindos do WAHA, que podem trazer aspas e fechar um atributo (XSS).
 * @param {unknown} value
 * @returns {string}
 */
export function escape(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Desenhos do Lucide (https://lucide.dev), sob a licença ISC:
//
// Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
// part of Feather (MIT). All other copyright (c) for Lucide are held by
// Lucide Contributors 2022.
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
const ICONS = {
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  listOrdered: '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  quote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

/**
 * Ícone SVG em linha. É decorativo (aria-hidden): o rótulo fica no botão.
 * @param {string} name Um dos nomes de ICONS.
 * @returns {string}
 */
export function icon(name) {
  const paths = ICONS[name];
  if (!paths) throw new Error(`Ícone desconhecido: "${name}".`);
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
```

`public/cron.js` (a lógica é a mesma do `app.js` atual, agora exportada):

```js
// Dias da semana e horário <-> expressão cron. A tela pede dias e horário; o
// arquivo continua guardando um cron, que é o que o agendador registra.

/**
 * Dias na ordem da tela: a semana começa na segunda, como no calendário
 * brasileiro, mas o número é o do cron (0 = domingo).
 */
export const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Monta o cron "minuto hora * * dias"; todos os dias viram "*".
 * @param {number[]} days Dias no número do cron (0 = domingo).
 * @param {string} time Horário "HH:MM".
 * @returns {string}
 */
export function buildCron(days, time) {
  const [hour, minute] = time.split(':').map(Number);
  const weekdays = days.length === WEEKDAYS.length ? '*' : [...days].sort((a, b) => a - b).join(',');
  return `${minute} ${hour} * * ${weekdays}`;
}

/**
 * Converte o cron de volta em dias e horário. Só o formato exato
 * "minuto hora * * dias" cabe; qualquer outra forma (passo, dia do mês, mês,
 * segundos, nome de dia) devolve null e fica como cron personalizado.
 * @param {string} expr
 * @returns {{days: number[], time: string} | null}
 */
export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, weekdays] = fields;
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return null;
  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) return null;
  if (dayOfMonth !== '*' || month !== '*') return null;

  const days = [];
  if (weekdays === '*') {
    days.push(...WEEKDAYS.map((d) => d.value));
  } else {
    for (const part of weekdays.split(',')) {
      const range = /^([0-7])(?:-([0-7]))?$/.exec(part);
      if (!range) return null;
      const start = Number(range[1]);
      const end = range[2] === undefined ? start : Number(range[2]);
      if (end < start) return null;
      // 7 também é domingo no cron.
      for (let day = start; day <= end; day++) days.push(day % 7);
    }
  }

  return {
    days: [...new Set(days)].sort((a, b) => a - b),
    time: `${pad(Number(hour))}:${pad(Number(minute))}`,
  };
}

/**
 * Descreve quando o agendamento dispara ("Seg, Qua e Sex às 09:00").
 * @param {string} expr
 * @returns {string|null} null para cron personalizado.
 */
export function describeCron(expr) {
  const parsed = parseCron(expr);
  if (!parsed) return null;

  const labels = WEEKDAYS.filter((d) => parsed.days.includes(d.value)).map((d) => d.label);
  const when = labels.length === WEEKDAYS.length ? 'Todo dia'
    : labels.length === 1 ? labels[0]
    : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
  return `${when} às ${parsed.time}`;
}
```

`public/dates.js`:

```js
// Datas por extenso no fuso do agendador (TIMEZONE), não no do navegador.

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

// Partes da data no fuso pedido. hourCycle h23 evita o "24:00" que alguns
// motores devolvem para meia-noite.
function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: Number(get('year')),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday: WEEKDAY_EN.indexOf(get('weekday')),
  };
}

// Dia do calendário como número, para comparar "hoje", "amanhã" e "ontem"
// no fuso pedido.
function dayNumber(p) {
  return Math.floor(Date.UTC(p.year, Number(p.month) - 1, Number(p.day)) / DAY_MS);
}

/**
 * Data e hora por extenso: "hoje, 18:00", "amanhã, 09:00", "ontem, 23:39",
 * "sex 18/09, 18:00" ou, em outro ano, "18/09/2025, 18:00".
 * @param {string|number|Date} when Instante a descrever.
 * @param {{timeZone?: string, now?: number}} [options] Fuso de referência
 *   (default: o do navegador) e "agora" em ms (default: Date.now()).
 * @returns {string}
 */
export function formatWhen(when, { timeZone, now = Date.now() } = {}) {
  const p = partsIn(new Date(when), timeZone);
  const today = partsIn(new Date(now), timeZone);
  const time = `${p.hour}:${p.minute}`;
  const diff = dayNumber(p) - dayNumber(today);
  if (diff === 0) return `hoje, ${time}`;
  if (diff === 1) return `amanhã, ${time}`;
  if (diff === -1) return `ontem, ${time}`;
  if (p.year !== today.year) return `${p.day}/${p.month}/${p.year}, ${time}`;
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day}/${p.month}, ${time}`;
}

/**
 * Só o horário, "HH:MM" ou "HH:MM:SS", no fuso pedido.
 * @param {string|number|Date} when
 * @param {{timeZone?: string, seconds?: boolean}} [options]
 * @returns {string}
 */
export function formatTime(when, { timeZone, seconds = false } = {}) {
  const p = partsIn(new Date(when), timeZone);
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-base.test.js test/ui-cron.test.js test/ui-dates.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/api.js public/html.js public/cron.js public/dates.js test/ui-base.test.js test/ui-cron.test.js test/ui-dates.test.js
git commit -m "Módulos base da tela: API, escape e ícones, cron e datas no fuso"
```

---

### Task 5: Formatação do WhatsApp

**Files:**
- Create: `public/whatsapp.js`
- Test: `test/ui-whatsapp.test.js`

**Interfaces:**
- Consumes: `escape` (Task 4)
- Produces: `formatWhatsApp(text): string` (HTML seguro); `toggleInline(text, start, end, marker)`, `toggleMonospace(text, start, end)`, `toggleLinePrefix(text, start, end, kind)` com `kind` em `'bullet'|'numbered'|'quote'`, `insertText(text, start, end, value)` — todas devolvem `{ text, start, end }`.

- [ ] **Step 1: Escrever os testes que falham** — `test/ui-whatsapp.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWhatsApp, toggleInline, toggleMonospace, toggleLinePrefix, insertText,
} from '../public/whatsapp.js';

const line = (html) => `<div class="wa-line">${html}</div>`;
const bullet = (mark, html) => `<div class="wa-li"><span class="wa-mark">${mark}</span><span>${html}</span></div>`;

test('negrito, itálico e tachado', () => {
  assert.equal(formatWhatsApp('*oi*'), line('<strong>oi</strong>'));
  assert.equal(formatWhatsApp('_oi_'), line('<em>oi</em>'));
  assert.equal(formatWhatsApp('~oi~'), line('<s>oi</s>'));
  assert.equal(formatWhatsApp('um *dois* três'), line('um <strong>dois</strong> três'));
});

test('marcador que não está colado na palavra não formata, como no WhatsApp', () => {
  // No começo da linha, "* " é lista; no meio, espaço dentro dos asteriscos
  // não formata.
  assert.equal(formatWhatsApp('a * oi * b'), line('a * oi * b'));
  assert.equal(formatWhatsApp('2*3*4'), line('2*3*4'));
  assert.equal(formatWhatsApp('nome_do_arquivo_final'), line('nome_do_arquivo_final'));
  assert.equal(formatWhatsApp('*sem fim'), line('*sem fim'));
});

test('pontuação conta como borda', () => {
  assert.equal(formatWhatsApp('(*oi*)!'), line('(<strong>oi</strong>)!'));
});

test('formatação aninhada', () => {
  assert.equal(formatWhatsApp('*_oi_*'), line('<strong><em>oi</em></strong>'));
});

test('não atravessa quebra de linha', () => {
  assert.equal(formatWhatsApp('*um\ndois*'), line('*um') + line('dois*'));
});

test('código na linha e bloco não recebem formatação por dentro', () => {
  assert.equal(formatWhatsApp('`*a*`'), line('<code>*a*</code>'));
  assert.equal(formatWhatsApp('```*a*\n_b_```'), line('<pre>*a*\n_b_</pre>'));
});

test('dígitos do texto não se confundem com os trechos guardados', () => {
  assert.equal(formatWhatsApp('`x` 0 1 2'), line('<code>x</code> 0 1 2'));
});

test('listas e citação', () => {
  assert.equal(formatWhatsApp('- item'), bullet('•', 'item'));
  assert.equal(formatWhatsApp('* item'), bullet('•', 'item'));
  assert.equal(formatWhatsApp('2. item'), bullet('2.', 'item'));
  assert.equal(formatWhatsApp('> citação'), '<div class="wa-quote">citação</div>');
});

test('linha vazia vira quebra', () => {
  assert.equal(formatWhatsApp('a\n\nb'), line('a') + line('<br>') + line('b'));
});

test('HTML no texto é sempre escapado, mesmo dentro da formatação', () => {
  const html = formatWhatsApp('<script>alert(1)</script> *"><img src=x onerror=alert(1)>*');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
});

test('negrito envolve a seleção e deixa os espaços das bordas de fora', () => {
  assert.deepEqual(toggleInline('um dois três', 2, 8, '*'), { text: 'um *dois* três', start: 4, end: 8 });
});

test('sem seleção, insere o par com o cursor no meio', () => {
  assert.deepEqual(toggleInline('oi ', 3, 3, '_'), { text: 'oi __', start: 4, end: 4 });
});

test('selecionar o texto já formatado tira a formatação', () => {
  assert.deepEqual(toggleInline('um *dois* três', 3, 9, '*'), { text: 'um dois três', start: 3, end: 7 });
  assert.deepEqual(toggleInline('um *dois* três', 4, 8, '*'), { text: 'um dois três', start: 3, end: 7 });
});

test('monoespaçado: uma linha vira código, várias viram bloco', () => {
  assert.deepEqual(toggleMonospace('a b', 2, 3), { text: 'a `b`', start: 3, end: 4 });
  assert.deepEqual(toggleMonospace('x\ny', 0, 3), { text: '```x\ny```', start: 3, end: 6 });
});

test('lista, lista numerada e citação nas linhas selecionadas', () => {
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 3, 'bullet'), { text: '- a\n- b', start: 0, end: 7 });
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 3, 'numbered'), { text: '1. a\n2. b', start: 0, end: 9 });
  assert.deepEqual(toggleLinePrefix('a', 1, 1, 'quote'), { text: '> a', start: 3, end: 3 });
});

test('se todas as linhas já têm o prefixo, tira', () => {
  assert.deepEqual(toggleLinePrefix('- a\n- b', 0, 7, 'bullet'), { text: 'a\nb', start: 0, end: 3 });
});

test('seleção que termina no começo da linha seguinte não a inclui', () => {
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 2, 'bullet'), { text: '- a\nb', start: 0, end: 3 });
});

test('prefixo na primeira linha, mesmo com o texto começando por quebra', () => {
  assert.deepEqual(toggleLinePrefix('\na', 0, 0, 'bullet'), { text: '- \na', start: 2, end: 2 });
});

test('emoji entra no lugar da seleção, com o cursor depois dele', () => {
  assert.deepEqual(insertText('oi mundo', 3, 8, '📚'), { text: 'oi 📚', start: 5, end: 5 });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-whatsapp.test.js`
Expected: FAIL — `Cannot find module '.../public/whatsapp.js'`

- [ ] **Step 3: Implementar** — `public/whatsapp.js`:

```js
// Formatação do WhatsApp: a prévia formatada e as ações da barra do editor.
// O texto guardado e enviado é sempre o cru, com os marcadores; só a prévia
// os interpreta. Sem DOM: importável pelos testes.

import { escape } from './html.js';

// Negrito, itálico e tachado só valem colados na palavra, como no WhatsApp:
// o marcador de abertura vem no início ou depois de algo que não é letra,
// número ou "_", seguido de caractere que não é espaço; o de fechamento vem
// depois de caractere que não é espaço, antes do fim ou de algo que não é
// letra ou número. Assim "2*3*4", "* texto *" e "nome_do_arquivo" ficam como
// estão. Nenhum atravessa quebra de linha.
const BOLD = /(^|[^\p{L}\p{N}_*])\*(?=\S)([^\n]*?\S)\*(?=$|[^\p{L}\p{N}_*])/gu;
const ITALIC = /(^|[^\p{L}\p{N}_])_(?=\S)([^\n]*?\S)_(?=$|[^\p{L}\p{N}_])/gu;
const STRIKE = /(^|[^\p{L}\p{N}_~])~(?=\S)([^\n]*?\S)~(?=$|[^\p{L}\p{N}_~])/gu;

const LINE_PREFIX = { bullet: /^[-*] /, numbered: /^\d+\. /, quote: /^> / };

function inline(html) {
  return html
    .replace(BOLD, '$1<strong>$2</strong>')
    .replace(ITALIC, '$1<em>$2</em>')
    .replace(STRIKE, '$1<s>$2</s>');
}

/**
 * Texto cru -> HTML da prévia, com as regras de formatação do WhatsApp.
 * O texto é escapado ANTES de qualquer formatação: nada que o usuário
 * digita vira HTML.
 * @param {string} text
 * @returns {string}
 */
export function formatWhatsApp(text) {
  const slots = [];
  const keep = (html) => `\uE000${slots.push(html) - 1}\uE001`;

  // Marcadores de uso privado do Unicode guardam o lugar de cada trecho
  // separado; o texto do usuário não os produz na prática.
  let html = escape(String(text ?? '').replace(/\r\n?/g, '\n'));

  // Blocos e código na linha saem primeiro e voltam no fim: o que está
  // dentro deles não recebe nenhuma outra formatação.
  html = html.replace(/```([\s\S]+?)```/g, (_, code) => keep(`<pre>${code}</pre>`));
  html = html.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));

  const lines = html.split('\n').map((line) => {
    let match;
    if ((match = /^&gt; (.*)$/.exec(line))) {
      return `<div class="wa-quote">${inline(match[1]) || '<br>'}</div>`;
    }
    if ((match = /^[-*] (.*)$/.exec(line))) {
      return `<div class="wa-li"><span class="wa-mark">•</span><span>${inline(match[1])}</span></div>`;
    }
    if ((match = /^(\d+)\. (.*)$/.exec(line))) {
      return `<div class="wa-li"><span class="wa-mark">${match[1]}.</span><span>${inline(match[2])}</span></div>`;
    }
    return `<div class="wa-line">${line ? inline(line) : '<br>'}</div>`;
  });

  return lines.join('').replace(/\uE000(\d+)\uE001/g, (_, index) => slots[Number(index)]);
}

/**
 * Liga ou desliga um marcador (negrito "*", itálico "_", tachado "~", código
 * "`" ou bloco "```") na seleção. Espaços nas bordas ficam fora dos
 * marcadores, porque o WhatsApp não formata "* texto *". Sem seleção,
 * insere o par com o cursor no meio.
 * @param {string} text Texto do campo.
 * @param {number} start Início da seleção.
 * @param {number} end Fim da seleção.
 * @param {string} marker
 * @returns {{text: string, start: number, end: number}} Texto e seleção novos.
 */
export function toggleInline(text, start, end, marker) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;

  const size = marker.length;
  if (from === to) {
    const at = from + size;
    return { text: text.slice(0, from) + marker + marker + text.slice(to), start: at, end: at };
  }

  const selected = text.slice(from, to);
  // Já formatado, com os marcadores dentro da seleção: tira.
  if (selected.length > size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(size, -size);
    return { text: text.slice(0, from) + inner + text.slice(to), start: from, end: from + inner.length };
  }
  // Já formatado, com os marcadores logo fora da seleção: tira.
  if (from >= size && text.slice(from - size, from) === marker && text.slice(to, to + size) === marker) {
    return {
      text: text.slice(0, from - size) + selected + text.slice(to + size),
      start: from - size,
      end: to - size,
    };
  }
  return {
    text: text.slice(0, from) + marker + selected + marker + text.slice(to),
    start: from + size,
    end: to + size,
  };
}

/**
 * Monoespaçado: seleção de uma linha vira código na linha (`texto`); de
 * várias linhas vira bloco (```texto```). Já formatada, desfaz.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{text: string, start: number, end: number}}
 */
export function toggleMonospace(text, start, end) {
  const multiline = text.slice(start, end).includes('\n');
  return toggleInline(text, start, end, multiline ? '```' : '`');
}

/**
 * Lista, lista numerada ou citação em cada linha tocada pela seleção. Se
 * todas as linhas com texto já têm o prefixo, tira.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {'bullet'|'numbered'|'quote'} kind
 * @returns {{text: string, start: number, end: number}}
 */
export function toggleLinePrefix(text, start, end, kind) {
  const pattern = LINE_PREFIX[kind];
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  // Seleção que termina logo depois de uma quebra não toca a linha seguinte.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const lineEnd = text.indexOf('\n', last);
  const to = lineEnd === -1 ? text.length : lineEnd;

  const lines = text.slice(from, to).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const removing = filled.length > 0 && filled.every((line) => pattern.test(line));

  let count = 0;
  const changed = lines.map((line) => {
    if (removing) return line.replace(pattern, '');
    if (line.trim() === '' && lines.length > 1) return line;
    count += 1;
    const prefix = kind === 'bullet' ? '- ' : kind === 'quote' ? '> ' : `${count}. `;
    return prefix + line.replace(pattern, '');
  });

  const block = changed.join('\n');
  const next = text.slice(0, from) + block + text.slice(to);
  return start === end
    ? { text: next, start: from + block.length, end: from + block.length }
    : { text: next, start: from, end: from + block.length };
}

/**
 * Insere um texto (um emoji, por exemplo) no lugar da seleção.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {string} value
 * @returns {{text: string, start: number, end: number}}
 */
export function insertText(text, start, end, value) {
  const at = start + value.length;
  return { text: text.slice(0, start) + value + text.slice(end), start: at, end: at };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-whatsapp.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/whatsapp.js test/ui-whatsapp.test.js
git commit -m "Prévia com a formatação do WhatsApp e ações da barra do editor"
```

---

### Task 6: Histórico por disparo e emojis

**Files:**
- Create: `public/history.js`, `public/emoji.js`
- Test: `test/ui-history.test.js`, `test/ui-emoji.test.js`

**Interfaces:**
- Produces:
  - `groupDispatches(logs): Array<{ name, manual, startedAt, entries, sent, failed }>` — mais recente primeiro; `entries` em ordem cronológica.
  - `EMOJI_CATEGORIES: Array<{ id, label, emojis: string[] }>` com ids `faces, people, nature, objects, symbols`; `recentEmojis(storage): string[]`; `rememberEmoji(storage, emoji): string[]`.

- [ ] **Step 1: Escrever os testes que falham**

`test/ui-history.test.js`:

```js
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
```

`test/ui-emoji.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_CATEGORIES, recentEmojis, rememberEmoji } from '../public/emoji.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

test('categorias com emojis, sem repetição entre elas', () => {
  const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
  assert.deepEqual(EMOJI_CATEGORIES.map((c) => c.id), ['faces', 'people', 'nature', 'objects', 'symbols']);
  assert.ok(EMOJI_CATEGORIES.every((c) => c.emojis.length >= 30), 'cada categoria precisa ter ao menos 30 emojis');
  assert.ok(all.every((e) => e.trim() !== ''), 'nenhum emoji vazio');
  assert.equal(new Set(all).size, all.length, 'nenhum emoji repetido');
});

test('recentes: o último usado vem primeiro, sem repetir, até 20', () => {
  const storage = memoryStorage();
  rememberEmoji(storage, '📚');
  rememberEmoji(storage, '🔥');
  rememberEmoji(storage, '📚');
  assert.deepEqual(recentEmojis(storage), ['📚', '🔥']);
  for (let i = 0; i < 30; i += 1) rememberEmoji(storage, String(i));
  assert.equal(recentEmojis(storage).length, 20);
});

test('sem armazenamento disponível, recentes fica vazio e nada quebra', () => {
  const blocked = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(recentEmojis(blocked), []);
  assert.deepEqual(rememberEmoji(blocked, '📚'), ['📚']);
  assert.deepEqual(recentEmojis(undefined), []);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-history.test.js test/ui-emoji.test.js`
Expected: FAIL — `Cannot find module '.../public/history.js'`

- [ ] **Step 3: Implementar**

`public/history.js`:

```js
// Agrupa o log de envios (uma linha por grupo) em disparos, para o histórico.

const GAP_MS = 60_000;
const MANUAL_SUFFIX = ' (manual)';
const LABEL_NAMES = { 'send-now': 'Envio pelo terminal' };

/**
 * Agrupa as linhas do log por disparo. Uma linha começa um disparo novo
 * quando o rótulo muda, quando passou mais de 60 s da anterior ou quando o
 * grupo já apareceu no disparo atual (um disparo manda uma vez para cada
 * grupo; isso separa disparos seguidos de um cron que roda a cada minuto).
 * @param {Array<{ts: string, status: 'sent'|'error', chatId: string, label?: string|null, error?: string}>} logs
 *   Em qualquer ordem; a API devolve do mais recente para o mais antigo.
 * @returns {Array<{name: string, manual: boolean, startedAt: string, entries: object[], sent: number, failed: number}>}
 *   Do disparo mais recente para o mais antigo; entries em ordem cronológica.
 */
export function groupDispatches(logs) {
  const ordered = [...logs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const dispatches = [];
  let current = null;

  for (const entry of ordered) {
    const label = entry.label ?? '';
    const previous = current?.entries.at(-1);
    const startsNew = !current
      || current.label !== label
      || Date.parse(entry.ts) - Date.parse(previous.ts) > GAP_MS
      || current.entries.some((e) => e.chatId === entry.chatId);
    if (startsNew) {
      current = { label, entries: [] };
      dispatches.push(current);
    }
    current.entries.push(entry);
  }

  return dispatches.reverse().map(({ label, entries }) => {
    const manual = label.endsWith(MANUAL_SUFFIX);
    const base = manual ? label.slice(0, -MANUAL_SUFFIX.length) : label;
    const failed = entries.filter((e) => e.status === 'error').length;
    return {
      name: LABEL_NAMES[base] ?? (base || 'Envio sem rótulo'),
      manual,
      startedAt: entries[0].ts,
      entries,
      sent: entries.length - failed,
      failed,
    };
  });
}
```

`public/emoji.js`:

```js
// Emojis do seletor do editor: lista embutida, sem biblioteca e sem internet.
// O que não estiver aqui dá para inserir pelo painel de emojis do sistema.

const RECENT_KEY = 'waha-scheduler:recent-emojis';
const RECENT_MAX = 20;
const list = (emojis) => emojis.split(' ');

/** Categorias na ordem do seletor. */
export const EMOJI_CATEGORIES = [
  {
    id: 'faces',
    label: 'Rostos',
    emojis: list('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 🤔 🤗 🤭 😴 😌 😬 🙄 😮 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 🤑 🤓'),
  },
  {
    id: 'people',
    label: 'Gestos e pessoas',
    emojis: list('👍 👎 👏 🙌 🙏 🤝 👋 ✌️ 🤞 👌 🤙 💪 👉 👈 👆 👇 ☝️ ✋ 🤚 🖐️ 👊 ✊ 🫶 👀 🧠 🗣️ 👤 👥 🧑‍💻 👩‍🏫 👨‍🏫 🧑‍🎓 👶 👨‍👩‍👧 💃 🕺 🏃 🙋 🤷 🙆'),
  },
  {
    id: 'nature',
    label: 'Natureza e comida',
    emojis: list('🌞 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ 🌧️ ❄️ 🌊 🌱 🌳 🌸 🌻 🍀 🍁 🐶 🐱 🦁 🐼 🦋 🐝 🍎 🍊 🍋 🍉 🍓 🍕 🍔 🍟 🍫 🍰 🎂 ☕ 🍺 🥂 🍷 🍿'),
  },
  {
    id: 'objects',
    label: 'Objetos',
    emojis: list('📚 📖 📕 📗 📘 📙 📓 📝 ✏️ 🖊️ 📌 📍 📎 🔗 📅 📆 ⏰ ⏳ 📢 📣 📱 💻 🖥️ 📷 🎥 🎧 🎁 🎉 🎊 🛒 🛍️ 💰 💵 💳 🏷️ 📦 🚚 🏠 🏆 🎯'),
  },
  {
    id: 'symbols',
    label: 'Símbolos',
    emojis: list('✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ❗ ❓ ‼️ ⁉️ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 ➡️ ⬅️ ⬆️ ⬇️ 🔝 🆕 🆓 🔔 ♻️ 💬'),
  },
];

/**
 * Emojis usados por último, do mais recente para o mais antigo.
 * @param {Storage|undefined} storage Normalmente o localStorage.
 * @returns {string[]}
 */
export function recentEmojis(storage) {
  // O armazenamento pode não existir ou lançar (navegação privada, bloqueio
  // do navegador). Sem ele, a aba Recentes só fica vazia: não é erro da tela.
  try {
    const parsed = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Registra um emoji como o mais recente.
 * @param {Storage|undefined} storage
 * @param {string} emoji
 * @returns {string[]} A lista atualizada.
 */
export function rememberEmoji(storage, emoji) {
  const next = [emoji, ...recentEmojis(storage).filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Mesmo motivo de recentEmojis: sem armazenamento, a lista vale só agora.
  }
  return next;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-history.test.js test/ui-emoji.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/history.js public/emoji.js test/ui-history.test.js test/ui-emoji.test.js
git commit -m "Histórico agrupado por disparo e emojis do editor"
```

---

### Task 7: Faixa de status

**Files:**
- Create: `public/status-view.js`
- Test: `test/ui-status-view.test.js`

**Interfaces:**
- Consumes: `escape`, `icon`, `formatWhen` (Task 4); formato de `GET /api/status` (Task 3)
- Produces: `schedulerNotice({ status, statusError, schedules, now }): { tone, text, detail? }` com `tone` em `'ok'|'warn'|'danger'|'neutral'`; `nextDispatch(schedules, nextRuns): { schedule, at } | null`; `statusBar({ status, statusError, groupsError, groupsLoaded, schedules, now }): string`.

- [ ] **Step 1: Escrever os testes que falham** — `test/ui-status-view.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-status-view.test.js`
Expected: FAIL — `Cannot find module '.../public/status-view.js'`

- [ ] **Step 3: Implementar** — `public/status-view.js`:

```js
// Faixa de status da tela: agendador, WAHA e próximo envio. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhen } from './dates.js';

/**
 * Qual aviso do agendador mostrar. Quando mais de um se aplica, vale o
 * primeiro desta ordem: sem conexão com o servidor da tela, nenhum
 * agendamento ativo, agendador parado ou sem resposta, recarga recusada,
 * rodando.
 * @param {{status: object|null, statusError: string|null, schedules: object[], now?: number}} input
 * @returns {{tone: 'ok'|'warn'|'danger'|'neutral', text: string, detail?: string}}
 */
export function schedulerNotice({ status, statusError, schedules, now }) {
  if (statusError) {
    return { tone: 'danger', text: 'Sem conexão com o servidor da tela', detail: statusError };
  }
  // O agendador encerra sozinho quando não há nada ativo: não é alarme.
  if (!schedules.some((s) => s.enabled)) {
    return { tone: 'neutral', text: 'Nenhum agendamento ativo' };
  }
  if (!status) return { tone: 'neutral', text: 'Verificando o agendador…' };

  const { state, beatAt, reloadError } = status.scheduler;
  if (state === 'stopped') {
    return { tone: 'danger', text: 'Agendador parado', detail: 'Nada vai sair até você rodar npm start.' };
  }
  if (state === 'unresponsive') {
    const last = beatAt ? `Último sinal: ${formatWhen(beatAt, { timeZone: status.timezone, now })}. ` : '';
    return {
      tone: 'danger',
      text: 'Agendador parou de responder',
      detail: `${last}Nada vai sair até ele voltar; se não voltar, rode npm start de novo.`,
    };
  }
  if (reloadError) {
    return { tone: 'warn', text: 'O agendador recusou a última alteração e segue com a anterior', detail: reloadError };
  }
  return { tone: 'ok', text: 'Agendador rodando' };
}

/**
 * O próximo envio entre todos os agendamentos ativos.
 * @param {object[]} schedules
 * @param {Record<string, string|null>|undefined} nextRuns
 * @returns {{schedule: object, at: string} | null}
 */
export function nextDispatch(schedules, nextRuns) {
  let best = null;
  for (const schedule of schedules) {
    const at = nextRuns?.[schedule.id];
    if (!schedule.enabled || !at) continue;
    if (!best || Date.parse(at) < Date.parse(best.at)) best = { schedule, at };
  }
  return best;
}

function item({ tone, text, detail }) {
  return `
    <span class="status-item tone-${tone}">
      <span class="dot" aria-hidden="true"></span>
      <span>${escape(text)}${detail ? `<span class="status-detail">${escape(detail)}</span>` : ''}</span>
    </span>`;
}

/**
 * HTML da faixa de status.
 * @param {{status: object|null, statusError: string|null, groupsError: string|null,
 *          groupsLoaded: boolean, schedules: object[], now?: number}} input
 * @returns {string}
 */
export function statusBar(input) {
  const notice = schedulerNotice(input);
  const { status, groupsError, groupsLoaded, schedules, now } = input;
  const waha = groupsError
    ? { tone: 'warn', text: 'WAHA indisponível', detail: groupsError }
    : groupsLoaded ? { tone: 'ok', text: 'WAHA conectado' } : { tone: 'neutral', text: 'Verificando o WAHA…' };

  // Com o agendador parado, "próximo envio" enganaria: nada vai sair.
  const running = notice.tone === 'ok' || notice.tone === 'warn';
  const next = running && status ? nextDispatch(schedules, status.nextRuns) : null;
  const nextHtml = next
    ? `<span class="status-next">${icon('clock')} Próximo envio: ${escape(formatWhen(next.at, { timeZone: status.timezone, now }))}, ${escape(next.schedule.name)}</span>`
    : '';

  return `${item(notice)}${item(waha)}${nextHtml}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-status-view.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/status-view.js test/ui-status-view.test.js
git commit -m "Faixa de status: agendador, WAHA e próximo envio"
```

---

### Task 8: HTML das abas, do painel e dos modais

**Files:**
- Create: `public/schedules-view.js`, `public/messages-view.js`, `public/history-view.js`
- Create: `test/fake-dom.js` (auxiliar, não roda sozinho)
- Test: `test/ui-views.test.js`

**Interfaces:**
- Consumes: `escape`, `icon`, `WEEKDAYS`, `buildCron`, `parseCron`, `describeCron`, `formatWhen`, `formatTime` (Task 4); `formatWhatsApp` (Task 5); `EMOJI_CATEGORIES` (Task 6)
- Produces:
  - `schedules-view.js`: `searchKey(value)`, `selectedCountLabel(count)`, `scheduleList({ schedules, messages, nextRuns?, timeZone?, now? })`, `scheduleForm({ schedule, messages, groups, groupsError?, composing?, timezoneLabel? })`, `formCron(form)`, `formGroups(form)`, `sendConfirm({ schedule, message, groupName })`, `sendResult({ schedule, result, groupName })`.
  - `messages-view.js`: `messageEditor({ nameField, textField, name?, text? })`, `emojiPanel({ active, recents })`, `messageList({ messages, schedules })`, `messageForm({ message })`.
  - `history-view.js`: `historyView({ dispatches, filter, groupName, timeZone?, now? })`.
  - `test/fake-dom.js`: `unescapeHtml`, `fakeForm(html)`, `fakeElement()`, `installDom(fetch)`.
- Marcações de que o `app.js` (Task 9) depende: `data-action` (`new-schedule`, `edit`, `toggle`, `run`, `delete-schedule`, `new-message`, `edit-message`, `delete-message`, `close-drawer`, `close-modal`, `compose-message`, `pick-message`, `days-weekdays`, `days-all`, `confirm-send`, `history-all`, `history-failed`), `data-format`, `data-emoji-tab`, `data-emoji`, `data-role` (`group-search`, `emoji-panel`, `editor-preview`, `history-name`), `textarea[data-editor]`, ids `form-schedule`, `form-message`, `drawer-title`, `modal-title`, `preview`, `message-preview`, `groups-count`, `groups-text`, e a classe `.form-error`.

- [ ] **Step 1: Escrever o auxiliar e os testes que falham**

`test/fake-dom.js`:

```js
// Formulário e DOM de mentira para testar a tela sem navegador.

export const unescapeHtml = (value) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const attr = (source, name) => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(source);
  return found ? unescapeHtml(found[1]) : undefined;
};

// Form montado a partir do HTML que a tela gerou, com o que as funções de
// leitura do formulário consultam. É o elo que prova que o que o formulário
// desenha é exatamente o que vira payload do save.
export function fakeForm(html) {
  const fields = [];
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    fields.push({
      id: attr(tag, 'id'),
      name: attr(tag, 'name'),
      value: attr(tag, 'value') ?? '',
      checked: /\schecked\b/.test(tag),
    });
  }
  for (const [, attrs, body] of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    fields.push({ id: attr(attrs, 'id'), name: attr(attrs, 'name'), value: unescapeHtml(body) });
  }
  for (const [, attrs, body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const option = /<option value="([^"]*)" selected/.exec(body) ?? /<option value="([^"]*)"/.exec(body);
    fields.push({ id: attr(attrs, 'id'), name: attr(attrs, 'name'), value: option ? unescapeHtml(option[1]) : '' });
  }

  return {
    id: /<form\b[^>]*\sid="([^"]*)"/.exec(html)?.[1],
    getAttribute: () => null,
    querySelector(selector) {
      const byId = /^#(.+)$/.exec(selector);
      if (byId) return fields.find((f) => f.id === byId[1]) ?? null;
      const byName = /^(?:input|textarea|select)?\[name="([^"]+)"\]$/.exec(selector);
      if (byName) return fields.find((f) => f.name === byName[1]) ?? null;
      if (selector === '[type="submit"]') return { disabled: false, isConnected: false };
      return null;
    },
    querySelectorAll(selector) {
      const checked = /^input\[name="([^"]+)"\]:checked$/.exec(selector);
      return checked ? fields.filter((f) => f.name === checked[1] && f.checked) : [];
    },
  };
}

// Elemento de mentira: guarda o que a tela escreve nele e devolve outro
// elemento de mentira para qualquer seletor, sempre o mesmo por seletor.
export function fakeElement() {
  const children = new Map();
  return {
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: false,
    open: false,
    disabled: false,
    returnValue: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    append() {},
    remove() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, fakeElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

// Instala um document e um fetch de mentira no globalThis e devolve um
// atalho para consultar os elementos que a tela usou.
export function installDom(fetch) {
  const elements = new Map();
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => fakeElement(),
  };
  globalThis.fetch = fetch;
  return (selector) => globalThis.document.querySelector(selector);
}
```

`test/ui-views.test.js` — os asserts de formulário e lista que hoje estão em `test/ui-app.test.js` (agora por import, com as funções recebendo os dados em vez de ler um estado global) e os novos:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleList, scheduleForm, formCron, formGroups, sendConfirm, sendResult, searchKey, selectedCountLabel,
} from '../public/schedules-view.js';
import { messageList, messageEditor, emojiPanel } from '../public/messages-view.js';
import { historyView } from '../public/history-view.js';
import { groupDispatches } from '../public/history.js';
import { fakeForm } from './fake-dom.js';

const KNOWN_GROUP = '111111111111111111@g.us';
const SAVED_UNKNOWN_GROUP = '777777777777777777@g.us';
const ALPHA = { id: KNOWN_GROUP, name: 'Grupo Alpha' };
const MESSAGES = [{ id: 'msg-a', name: 'Oi', text: 'Olá, *grupo*!' }];
const NOW = Date.parse('2026-09-11T18:00:00Z');
const SP = 'America/Sao_Paulo';

function form({ groups = [ALPHA], saved = [KNOWN_GROUP], cron = '0 9 * * 1', messages = MESSAGES, composing = false } = {}) {
  return scheduleForm({
    schedule: { id: 'sch-a', name: 'bom-dia', cron, messageId: 'msg-a', groups: saved, enabled: true },
    messages,
    groups,
    composing,
  });
}

// ---------- Formulário de agendamento (migrados de ui-app.test.js) ----------

test('grupo salvo que o WAHA não lista aparece no formulário, marcado e sinalizado', () => {
  const html = form({ saved: [SAVED_UNKNOWN_GROUP] });
  assert.ok(html.includes(`value="${SAVED_UNKNOWN_GROUP}"`), 'o grupo salvo tem que estar no formulário mesmo fora da lista do WAHA');
  assert.match(html, /não encontrado na lista atual do WAHA/, 'o grupo fora da lista tem que estar visivelmente sinalizado');
  assert.ok(html.includes(KNOWN_GROUP), 'os grupos listados pelo WAHA continuam aparecendo');
});

// O bug que este teste prende: com o grupo salvo ausente do formulário,
// formGroups() devolvia [] e a API trocava a lista vazia por defaultGroups —
// um PUT que só mudaria o nome levava a mensagem para outro grupo, calado.
test('salvar sem mexer nos grupos preserva o destino salvo que o WAHA não lista', () => {
  assert.deepEqual(formGroups(fakeForm(form({ saved: [SAVED_UNKNOWN_GROUP] }))), [SAVED_UNKNOWN_GROUP]);
});

test('grupo listado pelo WAHA e não salvo continua desmarcado', () => {
  const groups = [ALPHA, { id: '222222222222222222@g.us', name: 'Grupo Beta' }];
  assert.deepEqual(formGroups(fakeForm(form({ groups, saved: [KNOWN_GROUP] }))), [KNOWN_GROUP]);
});

test('agendamento novo sem grupos não marca nada', () => {
  const html = scheduleForm({ schedule: { messageId: 'msg-a', groups: [] }, messages: MESSAGES, groups: [ALPHA] });
  assert.deepEqual(formGroups(fakeForm(html)), []);
});

test('com o WAHA fora do ar, o campo livre já vem com os ids salvos', () => {
  const html = form({ groups: [], saved: [SAVED_UNKNOWN_GROUP, KNOWN_GROUP] });
  assert.ok(html.includes('id="groups-text"'), 'sem lista do WAHA, o campo livre é a saída');
  assert.deepEqual(formGroups(fakeForm(html)), [SAVED_UNKNOWN_GROUP, KNOWN_GROUP]);
});

test('agendamento salvo abre com os dias marcados e o horário preenchido', () => {
  const f = fakeForm(form({ cron: '30 8 * * 1,3' }));
  assert.deepEqual(f.querySelectorAll('input[name="day"]:checked').map((i) => i.value), ['1', '3']);
  assert.equal(f.querySelector('input[name="time"]').value, '08:30');
  assert.equal(f.querySelector('input[name="cron"]'), null, 'cron de dias e horário não mostra o campo cru');
});

test('salvar sem mexer mantém o mesmo cron de dias e horário', () => {
  assert.equal(formCron(fakeForm(form({ cron: '30 8 * * 1,3' }))), '30 8 * * 1,3');
});

// Um cron editado à mão que não cabe em dias e horário não pode ser trocado
// por outro em silêncio só porque o usuário abriu e salvou o agendamento.
test('cron personalizado aparece como está, sinalizado, e salvar sem mexer o mantém', () => {
  const html = form({ cron: '*/15 * * * *' });
  assert.match(html, /cron personalizado/i, 'o usuário tem que ver por que não há dias e horário');
  assert.equal(formCron(fakeForm(html)), '*/15 * * * *');
});

test('agendamento novo abre sem dia marcado e sem horário', () => {
  const f = fakeForm(scheduleForm({ schedule: { messageId: 'msg-a', groups: [] }, messages: MESSAGES, groups: [] }));
  assert.equal(f.querySelectorAll('input[name="day"]:checked').length, 0);
  assert.equal(f.querySelector('input[name="time"]').value, '');
  assert.equal(formCron(f), '', 'sem dia nem horário não sai cron');
});

test('sem nenhum dia marcado não sai cron, mesmo com horário', () => {
  const f = {
    querySelector: (selector) => (selector === 'input[name="time"]' ? { value: '09:00' } : null),
    querySelectorAll: () => [],
  };
  assert.equal(formCron(f), '');
});

test('a lista mostra quando dispara por extenso e o cron personalizado cru', () => {
  const html = scheduleList({
    schedules: [
      { id: 'a', name: 'semana', cron: '0 9 * * 1-5', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
      { id: 'b', name: 'quinze', cron: '*/15 * * * *', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
    ],
    messages: MESSAGES,
  });
  assert.match(html, /Seg, Ter, Qua, Qui e Sex às 09:00/);
  assert.match(html, /<code>\*\/15 \* \* \* \*<\/code>/);
});

// ---------- Novos ----------

test('a lista mostra o próximo envio por extenso e marca o pausado', () => {
  const html = scheduleList({
    schedules: [
      { id: 'a', name: 'resumo', cron: '0 18 * * 5', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
      { id: 'b', name: 'live', cron: '30 19 * * 3', messageId: 'msg-a', groups: [KNOWN_GROUP, '2@g.us'], enabled: false },
    ],
    messages: MESSAGES,
    nextRuns: { a: '2026-09-11T21:00:00Z' },
    timeZone: SP,
    now: NOW,
  });
  assert.match(html, /Próximo: <strong>hoje, 18:00<\/strong>/);
  assert.match(html, /Pausado/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /2 grupos/);
  assert.match(html, /1 grupo</);
});

test('lista vazia convida a criar o primeiro agendamento', () => {
  assert.match(scheduleList({ schedules: [], messages: [] }), /Crie seu primeiro agendamento/);
});

test('nome com HTML é escapado na lista e no formulário', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const schedule = { id: 'a', name: evil, cron: '0 9 * * 1', messageId: 'msg-a', groups: [], enabled: true };
  assert.doesNotMatch(scheduleList({ schedules: [schedule], messages: MESSAGES }), /<img/);
  assert.doesNotMatch(scheduleForm({ schedule, messages: MESSAGES, groups: [] }), /<img/);
});

test('"Escrever nova" troca a seleção pelo editor, com o nome do agendamento', () => {
  const f = fakeForm(form({ composing: true }));
  assert.equal(f.querySelector('[name="messageId"]'), null, 'sem seleção de mensagem existente');
  assert.equal(f.querySelector('[name="messageName"]').value, 'bom-dia');
  assert.equal(f.querySelector('[name="messageText"]').value, '');
});

test('sem nenhuma mensagem salva, o formulário já abre no editor', () => {
  const f = fakeForm(scheduleForm({ schedule: { name: '', groups: [] }, messages: [], groups: [] }));
  assert.ok(f.querySelector('[name="messageText"]'));
});

test('a mensagem escolhida aparece formatada no balão', () => {
  assert.match(form(), /Olá, <strong>grupo<\/strong>!/);
});

test('o nome do fuso aparece junto dos próximos envios', () => {
  const html = scheduleForm({
    schedule: { name: '', cron: '0 9 * * 1', groups: [] }, messages: MESSAGES, groups: [],
    timezoneLabel: 'Horário Padrão de Brasília',
  });
  assert.match(html, /Horário Padrão de Brasília/);
  assert.match(html, /id="preview"/);
});

test('busca de grupos ignora maiúsculas e acentos; contador no singular e no plural', () => {
  assert.equal(searchKey('Leitores de São Paulo'), 'leitores de sao paulo');
  assert.equal(selectedCountLabel(1), '1 selecionado');
  assert.equal(selectedCountLabel(3), '3 selecionados');
});

test('confirmação de envio mostra a mensagem, os grupos por nome e quantos vão receber', () => {
  const html = sendConfirm({
    schedule: { id: 'sch-a', name: 'bom-dia', groups: [KNOWN_GROUP, SAVED_UNKNOWN_GROUP] },
    message: MESSAGES[0],
    groupName: (id) => (id === KNOWN_GROUP ? 'Grupo Alpha' : id),
  });
  assert.match(html, /Enviar "bom-dia" agora\?/);
  assert.match(html, /Olá, <strong>grupo<\/strong>!/);
  assert.match(html, /Grupo Alpha/);
  assert.match(html, /Enviar para 2 grupos/);
});

test('resultado do envio lista cada falha com o erro', () => {
  const html = sendResult({
    schedule: { name: 'bom-dia' },
    result: {
      sent: 1,
      failed: 1,
      results: [
        { chatId: KNOWN_GROUP, status: 'sent' },
        { chatId: SAVED_UNKNOWN_GROUP, status: 'error', error: 'Erro 500 ao enviar' },
      ],
    },
    groupName: (id) => id,
  });
  assert.match(html, /Enviado para 1 de 2 grupos/);
  assert.match(html, /777777777777777777@g\.us<\/strong>: Erro 500 ao enviar/);
});

test('mensagens mostram quem as usa e quais não são usadas', () => {
  const html = messageList({
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá' }, { id: 'msg-b', name: 'Tchau', text: 'Até' }],
    schedules: [{ id: 'a', name: 'bom-dia', messageId: 'msg-a' }],
  });
  assert.match(html, /Usada por bom-dia/);
  assert.match(html, /Não usada/);
});

test('o editor traz a barra de formatação completa e a prévia do texto', () => {
  const html = messageEditor({ nameField: 'name', textField: 'text', name: 'Oi', text: '*oi*' });
  for (const format of ['bold', 'italic', 'strike', 'mono', 'bullet', 'numbered', 'quote', 'emoji']) {
    assert.ok(html.includes(`data-format="${format}"`), `falta o botão ${format}`);
  }
  assert.match(html, /<strong>oi<\/strong>/);
});

test('seletor de emojis: recentes vazio explica; categoria mostra os emojis', () => {
  assert.match(emojiPanel({ active: 'recent', recents: [] }), /Os emojis que você usar aparecem aqui/);
  assert.match(emojiPanel({ active: 'objects', recents: [] }), /data-emoji="📚"/);
});

test('histórico: disparo com falha já vem aberto, com o erro de cada grupo', () => {
  const logs = [
    { ts: '2026-09-11T12:00:08Z', status: 'error', chatId: '2@g.us', label: 'ofertas', error: 'sessão desconectada' },
    { ts: '2026-09-11T12:00:02Z', status: 'sent', chatId: '1@g.us', label: 'ofertas' },
    { ts: '2026-09-10T02:39:50Z', status: 'sent', chatId: '1@g.us', label: 'Teste (manual)' },
  ];
  const html = historyView({
    dispatches: groupDispatches(logs),
    filter: { name: '', onlyFailed: false },
    groupName: (id) => (id === '1@g.us' ? 'Grupo Alpha' : id),
    timeZone: SP,
    now: NOW,
  });
  assert.equal(html.match(/ open>/g).length, 1, 'só o disparo com falha abre sozinho');
  assert.match(html, /1 de 2 grupos/);
  assert.match(html, /2@g\.us: sessão desconectada/);
  assert.match(html, /class="tag">manual</);
});

test('histórico filtra por agendamento e por falha', () => {
  const dispatches = groupDispatches([
    { ts: '2026-09-11T12:00:00Z', status: 'sent', chatId: '1@g.us', label: 'ofertas' },
    { ts: '2026-09-11T13:00:00Z', status: 'error', chatId: '1@g.us', label: 'resumo', error: 'x' },
  ]);
  const view = (filter) => historyView({ dispatches, filter, groupName: (id) => id, timeZone: SP, now: NOW });
  const onlyFailed = view({ name: '', onlyFailed: true });
  assert.match(onlyFailed, /row-title-text">resumo/);
  assert.doesNotMatch(onlyFailed, /row-title-text">ofertas/);
  assert.doesNotMatch(view({ name: 'ofertas', onlyFailed: false }), /row-title-text">resumo/);
});

test('histórico vazio explica de onde vêm os envios', () => {
  const html = historyView({ dispatches: [], filter: { name: '', onlyFailed: false }, groupName: (id) => id });
  assert.match(html, /Nenhum envio registrado/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-views.test.js`
Expected: FAIL — `Cannot find module '.../public/schedules-view.js'`

- [ ] **Step 3: Implementar**

`public/messages-view.js`:

```js
// Aba de mensagens e o editor de mensagem, que também é usado no "Escrever
// nova" do formulário de agendamento. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhatsApp } from './whatsapp.js';
import { EMOJI_CATEGORIES } from './emoji.js';

const EMPTY_PREVIEW = '<span class="muted">A prévia aparece aqui.</span>';

// null é um separador entre grupos de botões.
const FORMAT_BUTTONS = [
  { format: 'bold', icon: 'bold', label: 'Negrito (⌘B)' },
  { format: 'italic', icon: 'italic', label: 'Itálico (⌘I)' },
  { format: 'strike', icon: 'strikethrough', label: 'Tachado' },
  { format: 'mono', icon: 'code', label: 'Monoespaçado' },
  null,
  { format: 'bullet', icon: 'list', label: 'Lista' },
  { format: 'numbered', icon: 'listOrdered', label: 'Lista numerada' },
  { format: 'quote', icon: 'quote', label: 'Citação' },
  null,
  { format: 'emoji', icon: 'smile', label: 'Emojis' },
];

/**
 * HTML do editor de mensagem: nome, barra de formatação, texto cru e prévia.
 * @param {{nameField: string, textField: string, name?: string, text?: string}} input
 *   nameField/textField: atributos "name" dos campos no formulário.
 * @returns {string}
 */
export function messageEditor({ nameField, textField, name = '', text = '' }) {
  const toolbar = FORMAT_BUTTONS.map((button) => (button
    ? `<button type="button" class="tool" data-format="${button.format}" title="${escape(button.label)}" aria-label="${escape(button.label)}">${icon(button.icon)}</button>`
    : '<span class="tool-sep" aria-hidden="true"></span>')).join('');

  return `
    <div class="editor">
      <label class="field">
        <span class="field-label">Nome da mensagem</span>
        <input type="text" name="${nameField}" value="${escape(name)}" required autocomplete="off" />
      </label>
      <div class="editor-grid">
        <div class="editor-input">
          <div class="toolbar" role="toolbar" aria-label="Formatação">${toolbar}</div>
          <textarea name="${textField}" data-editor rows="9" required aria-label="Texto da mensagem"
            placeholder="Bom dia! *Ofertas de hoje* 📚">${escape(text)}</textarea>
          <div class="emoji-panel" data-role="emoji-panel" hidden></div>
        </div>
        <div class="editor-preview">
          <p class="hint">Como chega no grupo</p>
          <div class="chat"><div class="bubble" data-role="editor-preview">${text.trim() ? formatWhatsApp(text) : EMPTY_PREVIEW}</div></div>
        </div>
      </div>
    </div>`;
}

/**
 * HTML do seletor de emojis, com a aba ativa.
 * @param {{active: string, recents: string[]}} input active: "recent" ou o id de uma categoria.
 * @returns {string}
 */
export function emojiPanel({ active, recents }) {
  const tabs = [{ id: 'recent', label: 'Recentes' }, ...EMOJI_CATEGORIES];
  const emojis = active === 'recent' ? recents : EMOJI_CATEGORIES.find((c) => c.id === active)?.emojis ?? [];
  const grid = emojis.length === 0
    ? '<p class="hint">Os emojis que você usar aparecem aqui.</p>'
    : emojis.map((e) => `<button type="button" class="emoji" data-emoji="${escape(e)}" aria-label="${escape(e)}">${escape(e)}</button>`).join('');

  return `
    <div class="emoji-tabs" role="tablist" aria-label="Categorias de emoji">
      ${tabs.map((t) => `<button type="button" role="tab" aria-selected="${t.id === active}" data-emoji-tab="${t.id}">${escape(t.label)}</button>`).join('')}
    </div>
    <div class="emoji-grid">${grid}</div>`;
}

/**
 * HTML da lista de mensagens.
 * @param {{messages: object[], schedules: object[]}} input
 * @returns {string}
 */
export function messageList({ messages, schedules }) {
  if (messages.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Escreva sua primeira mensagem</p>
        <p>Uma mensagem pode ser usada por vários agendamentos.</p>
        <button type="button" class="btn" data-action="new-message">${icon('plus')} Nova mensagem</button>
      </div>`;
  }

  const rows = messages.map((m) => {
    const usedBy = schedules.filter((s) => s.messageId === m.id).map((s) => s.name);
    const id = escape(m.id);
    return `
      <li class="row message-row">
        <div class="row-main">
          <button type="button" class="row-title" data-action="edit-message" data-id="${id}">${escape(m.name)}</button>
          <div class="message-snippet">${formatWhatsApp(m.text)}</div>
        </div>
        <div class="row-sub">${usedBy.length ? `Usada por ${escape(usedBy.join(', '))}` : 'Não usada'}</div>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit-message" data-id="${id}" title="Editar" aria-label="Editar ${escape(m.name)}">${icon('pencil')}</button>
          <button type="button" class="icon-btn danger" data-action="delete-message" data-id="${id}" title="Excluir" aria-label="Excluir ${escape(m.name)}">${icon('trash')}</button>
        </div>
      </li>`;
  }).join('');

  return `<ul class="rows">${rows}</ul>`;
}

/**
 * HTML do formulário de mensagem, no painel lateral.
 * @param {{message: {id?: string, name?: string, text?: string}}} input
 * @returns {string}
 */
export function messageForm({ message }) {
  return `
    <form id="form-message" class="drawer-form" novalidate>
      <header class="drawer-header">
        <h2 id="drawer-title">${message.id ? 'Editar mensagem' : 'Nova mensagem'}</h2>
        <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="drawer-body">
        ${messageEditor({ nameField: 'name', textField: 'text', name: message.name ?? '', text: message.text ?? '' })}
      </div>
      <footer class="drawer-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn" data-action="close-drawer">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </footer>
    </form>`;
}
```

`public/schedules-view.js`:

```js
// Aba de agendamentos: a lista, o formulário do painel lateral e o modal de
// envio imediato. Só gera HTML e lê o formulário recebido.

import { escape, icon } from './html.js';
import { WEEKDAYS, buildCron, parseCron, describeCron } from './cron.js';
import { formatWhen } from './dates.js';
import { formatWhatsApp } from './whatsapp.js';
import { messageEditor } from './messages-view.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Chave de busca de um nome: minúsculas e sem acentos.
 * @param {string} value
 * @returns {string}
 */
export function searchKey(value) {
  return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Texto do contador de grupos marcados.
 * @param {number} count
 * @returns {string}
 */
export function selectedCountLabel(count) {
  return count === 1 ? '1 selecionado' : `${count} selecionados`;
}

function nextText(schedule, nextRuns, timeZone, now) {
  if (!schedule.enabled) return 'Pausado';
  if (!(schedule.id in nextRuns)) return '';
  const next = nextRuns[schedule.id];
  return next ? `Próximo: <strong>${escape(formatWhen(next, { timeZone, now }))}</strong>` : 'Nenhum envio previsto';
}

function scheduleRow(s, { messages, nextRuns, timeZone, now }) {
  const when = describeCron(s.cron);
  const message = messages.find((m) => m.id === s.messageId);
  const id = escape(s.id);
  const name = escape(s.name);
  return `
    <li class="row schedule-row${s.enabled ? '' : ' is-paused'}">
      <button type="button" class="switch" role="switch" aria-checked="${s.enabled}" data-action="toggle" data-id="${id}"
        aria-label="${s.enabled ? 'Pausar' : 'Ativar'} ${name}" title="${s.enabled ? 'Ativo: clique para pausar' : 'Pausado: clique para ativar'}"></button>
      <div class="row-main">
        <button type="button" class="row-title" data-action="edit" data-id="${id}">${name}</button>
        <div class="row-sub">${when ? escape(when) : `<code>${escape(s.cron)}</code>`} · ${escape(message?.name ?? 'mensagem não encontrada')}</div>
      </div>
      <div class="row-next">${nextText(s, nextRuns, timeZone, now)}</div>
      <div class="row-count">${plural(s.groups.length, 'grupo', 'grupos')}</div>
      <div class="row-actions">
        <button type="button" class="btn btn-danger-outline btn-sm" data-action="run" data-id="${id}">${icon('send')} Enviar agora</button>
        <details class="menu">
          <summary class="icon-btn" aria-label="Mais ações para ${name}">${icon('ellipsis')}</summary>
          <div class="menu-items">
            <button type="button" data-action="edit" data-id="${id}">${icon('pencil')} Editar</button>
            <button type="button" class="danger" data-action="delete-schedule" data-id="${id}">${icon('trash')} Excluir</button>
          </div>
        </details>
      </div>
    </li>`;
}

/**
 * HTML da lista de agendamentos.
 * @param {{schedules: object[], messages: object[], nextRuns?: Record<string, string|null>,
 *          timeZone?: string, now?: number}} input nextRuns: de GET /api/status.
 * @returns {string}
 */
export function scheduleList({ schedules, messages, nextRuns = {}, timeZone, now }) {
  if (schedules.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Crie seu primeiro agendamento</p>
        <p>Escolha a mensagem, os dias, o horário e os grupos. O agendador envia sozinho.</p>
        <button type="button" class="btn" data-action="new-schedule">${icon('plus')} Novo agendamento</button>
      </div>`;
  }
  return `<ul class="rows">${schedules.map((s) => scheduleRow(s, { messages, nextRuns, timeZone, now })).join('')}</ul>`;
}

// Um cron personalizado (editado à mão no arquivo) aparece cru e é mantido
// como está: convertê-lo em dias e horário em silêncio mudaria quando o
// agendamento dispara, num save que talvez só quisesse trocar a mensagem.
function whenSection(schedule, timezoneLabel) {
  const when = schedule.cron ? parseCron(schedule.cron) : { days: [], time: '' };
  const zone = timezoneLabel ? `${escape(timezoneLabel)}. ` : '';
  const preview = `<p class="hint">${zone}<span id="preview" class="preview">—</span></p>`;

  if (!when) {
    return `
      <fieldset class="field">
        <legend class="field-label">Quando</legend>
        <p class="note">Este agendamento usa um cron personalizado, que não cabe em dias e horário. Ele é mantido como está.</p>
        <input type="text" name="cron" value="${escape(schedule.cron)}" required autocomplete="off" aria-label="Expressão cron" />
        ${preview}
      </fieldset>`;
  }

  const days = WEEKDAYS.map((d) => `
          <label class="day">
            <input type="checkbox" name="day" value="${escape(d.value)}" ${when.days.includes(d.value) ? 'checked' : ''} />
            <span>${escape(d.label)}</span>
          </label>`).join('');

  return `
    <fieldset class="field">
      <legend class="field-label">Quando</legend>
      <div class="days">${days}</div>
      <div class="when-row">
        <button type="button" class="link" data-action="days-weekdays">Dias úteis</button>
        <button type="button" class="link" data-action="days-all">Todo dia</button>
        <label class="time">
          <span class="visually-hidden">Horário</span>
          <input type="time" name="time" value="${escape(when.time)}" required />
        </label>
      </div>
      ${preview}
    </fieldset>`;
}

function messageSection(schedule, messages, composing) {
  if (composing || messages.length === 0) {
    const pick = messages.length > 0
      ? '<button type="button" class="link field-aside" data-action="pick-message">Escolher uma existente</button>'
      : '';
    return `
      <fieldset class="field">
        <legend class="field-label">Mensagem</legend>
        ${pick}
        ${messageEditor({ nameField: 'messageName', textField: 'messageText', name: schedule.name ?? '' })}
      </fieldset>`;
  }

  const selected = messages.find((m) => m.id === schedule.messageId) ?? messages[0];
  const options = messages
    .map((m) => `<option value="${escape(m.id)}" ${m.id === selected.id ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');
  return `
    <fieldset class="field">
      <legend class="field-label">Mensagem</legend>
      <button type="button" class="link field-aside" data-action="compose-message">${icon('plus')} Escrever nova</button>
      <select name="messageId" required aria-label="Mensagem">${options}</select>
      <div class="chat"><div class="bubble" id="message-preview">${formatWhatsApp(selected.text)}</div></div>
    </fieldset>`;
}

function groupsSection(saved, groups, groupsError) {
  // Sem lista do WAHA, o campo livre já vem preenchido com os ids salvos:
  // nada se perde por o WAHA estar fora do ar.
  if (groups.length === 0) {
    const note = groupsError
      ? 'A lista de grupos do WAHA não está disponível. Digite os ids separados por vírgula.'
      : 'Carregando a lista de grupos do WAHA. Enquanto isso, dá para digitar os ids separados por vírgula.';
    return `
      <fieldset class="field">
        <legend class="field-label">Grupos</legend>
        <p class="note">${note}</p>
        <input type="text" id="groups-text" value="${escape(saved.join(','))}" placeholder="120363000000000000@g.us" autocomplete="off" aria-label="Ids dos grupos" />
      </fieldset>`;
  }

  // Um grupo já salvo que o WAHA não lista (o bot saiu do grupo, a sessão
  // reconectou com a lista parcial, o id foi digitado à mão) continua no
  // formulário, marcado, sinalizado e primeiro: é o que o usuário precisa
  // decidir. Se ele sumisse, formGroups() devolveria a lista sem ele e o
  // save trocaria o destino em silêncio.
  const missing = saved.filter((id) => !groups.some((g) => g.id === id));
  const option = (id, name, notFound) => `
        <label class="group${notFound ? ' group-missing' : ''}" data-name="${escape(searchKey(name))}">
          <input type="checkbox" name="group" value="${escape(id)}" ${saved.includes(id) ? 'checked' : ''} />
          <span class="group-name">${escape(name)}</span>
          ${notFound ? '<small class="warn">não encontrado na lista atual do WAHA</small>' : `<small class="group-id">${escape(id)}</small>`}
        </label>`;

  return `
    <fieldset class="field">
      <legend class="field-label">Grupos</legend>
      <span class="field-aside" id="groups-count">${selectedCountLabel(saved.length)}</span>
      <input type="search" class="group-search" data-role="group-search" placeholder="Buscar grupo" aria-label="Buscar grupo" autocomplete="off" />
      <div class="group-list">
        ${missing.map((id) => option(id, id, true)).join('')}
        ${groups.map((g) => option(g.id, g.name, false)).join('')}
      </div>
    </fieldset>`;
}

/**
 * HTML do formulário de agendamento, no painel lateral.
 * @param {{schedule: object, messages: object[], groups: {id: string, name: string}[],
 *          groupsError?: string|null, composing?: boolean, timezoneLabel?: string}} input
 *   schedule: o agendamento em edição (sem id quando é novo).
 *   groups: lista do WAHA; vazia quando ela não chegou.
 *   composing: true mostra o editor de mensagem nova no lugar da seleção.
 * @returns {string}
 */
export function scheduleForm({ schedule, messages, groups, groupsError = null, composing = false, timezoneLabel = '' }) {
  return `
    <form id="form-schedule" class="drawer-form" novalidate>
      <header class="drawer-header">
        <h2 id="drawer-title">${schedule.id ? 'Editar agendamento' : 'Novo agendamento'}</h2>
        <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="drawer-body">
        <label class="field">
          <span class="field-label">Nome</span>
          <input type="text" name="name" value="${escape(schedule.name ?? '')}" required autocomplete="off" />
        </label>
        ${whenSection(schedule, timezoneLabel)}
        ${messageSection(schedule, messages, composing)}
        ${groupsSection(schedule.groups ?? [], groups, groupsError)}
      </div>
      <footer class="drawer-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn" data-action="close-drawer">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </footer>
    </form>`;
}

/**
 * Cron que o formulário representa agora: o campo cru, se o agendamento tem
 * cron personalizado; senão, o montado a partir dos dias e do horário.
 * Devolve '' enquanto faltar dia ou horário.
 * @param {{querySelector: Function, querySelectorAll: Function}} form
 * @returns {string}
 */
export function formCron(form) {
  const custom = form.querySelector('input[name="cron"]');
  if (custom) return custom.value.trim();

  const days = [...form.querySelectorAll('input[name="day"]:checked')].map((input) => Number(input.value));
  const time = form.querySelector('input[name="time"]')?.value ?? '';
  return days.length > 0 && time ? buildCron(days, time) : '';
}

/**
 * Grupos marcados no formulário, ou os digitados quando a lista do WAHA não veio.
 * @param {{querySelector: Function, querySelectorAll: Function}} form
 * @returns {string[]}
 */
export function formGroups(form) {
  const text = form.querySelector('#groups-text');
  if (text) return text.value.split(',').map((g) => g.trim()).filter(Boolean);
  return [...form.querySelectorAll('input[name="group"]:checked')].map((input) => input.value);
}

/**
 * HTML do modal que confirma um envio imediato.
 * @param {{schedule: object, message: object|undefined, groupName: (id: string) => string}} input
 * @returns {string}
 */
export function sendConfirm({ schedule, message, groupName }) {
  const count = schedule.groups.length;
  return `
    <div class="modal-box">
      <h2 id="modal-title">Enviar "${escape(schedule.name)}" agora?</h2>
      <p class="modal-text">A mensagem vai de verdade para ${count === 1 ? 'o grupo abaixo' : 'os grupos abaixo'}, fora do horário agendado.</p>
      <div class="chat"><div class="bubble">${message ? formatWhatsApp(message.text) : '<span class="muted">Mensagem não encontrada.</span>'}</div></div>
      <ul class="chips">${schedule.groups.map((id) => `<li class="chip">${escape(groupName(id))}</li>`).join('')}</ul>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancelar</button>
        <button type="button" class="btn btn-danger" data-action="confirm-send" data-id="${escape(schedule.id)}">${icon('send')} Enviar para ${plural(count, 'grupo', 'grupos')}</button>
      </div>
    </div>`;
}

/**
 * HTML do resultado de um envio imediato.
 * @param {{schedule: object, result: {sent: number, failed: number, results: object[]},
 *          groupName: (id: string) => string}} input result: resposta de POST /run.
 * @returns {string}
 */
export function sendResult({ schedule, result, groupName }) {
  const total = result.sent + result.failed;
  const failures = result.results.filter((r) => r.status === 'error');
  const list = failures.length
    ? `<ul class="failures">${failures.map((f) => `<li>${icon('x')}<span><strong>${escape(groupName(f.chatId))}</strong>: ${escape(f.error ?? 'falha sem detalhe')}</span></li>`).join('')}</ul>`
    : '';
  return `
    <div class="modal-box">
      <h2 id="modal-title">Enviado para ${result.sent} de ${plural(total, 'grupo', 'grupos')}</h2>
      <p class="modal-text">"${escape(schedule.name)}" ${failures.length ? 'teve falhas:' : 'foi enviado agora.'}</p>
      ${list}
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-action="close-modal">Fechar</button>
      </div>
    </div>`;
}
```

`public/history-view.js`:

```js
// Aba de histórico: envios agrupados por disparo, com filtros. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhen, formatTime } from './dates.js';

function dispatchItem(d, { groupName, timeZone, now }) {
  const total = d.entries.length;
  const entries = d.entries.map((e) => `
    <li class="${e.status === 'error' ? 'text-danger' : ''}">
      ${icon(e.status === 'error' ? 'x' : 'check')}
      <span>${escape(groupName(e.chatId))}${e.status === 'error' ? `: ${escape(e.error ?? 'falha sem detalhe')}` : ''}</span>
      <span class="entry-time">${escape(formatTime(e.ts, { timeZone, seconds: true }))}</span>
    </li>`).join('');

  return `
    <li>
      <details class="dispatch${d.failed ? ' has-failure' : ''}"${d.failed ? ' open' : ''}>
        <summary class="row dispatch-row">
          <span class="dispatch-icon ${d.failed ? 'tone-danger' : 'tone-ok'}">${icon(d.failed ? 'alert' : 'circleCheck')}</span>
          <span class="row-main"><span class="row-title-text">${escape(d.name)}</span>${d.manual ? '<span class="tag">manual</span>' : ''}</span>
          <span class="dispatch-count ${d.failed ? 'text-danger' : 'row-sub'}">${d.sent} de ${total} ${total === 1 ? 'grupo' : 'grupos'}</span>
          <span class="dispatch-when row-sub">${escape(formatWhen(d.startedAt, { timeZone, now }))}</span>
          <span class="chevron">${icon('chevronDown')}</span>
        </summary>
        <ul class="dispatch-entries">${entries}</ul>
      </details>
    </li>`;
}

/**
 * HTML do histórico.
 * @param {{dispatches: object[], filter: {name: string, onlyFailed: boolean},
 *          groupName: (id: string) => string, timeZone?: string, now?: number}} input
 *   dispatches: saída de groupDispatches.
 * @returns {string}
 */
export function historyView({ dispatches, filter, groupName, timeZone, now }) {
  if (dispatches.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Nenhum envio registrado</p>
        <p>Os envios do agendador e do "Enviar agora" aparecem aqui.</p>
      </div>`;
  }

  const names = [...new Set(dispatches.map((d) => d.name))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const visible = dispatches.filter((d) =>
    (!filter.name || d.name === filter.name) && (!filter.onlyFailed || d.failed > 0));

  const filters = `
    <div class="filters">
      <select data-role="history-name" aria-label="Filtrar por agendamento">
        <option value="">Todos os agendamentos</option>
        ${names.map((n) => `<option value="${escape(n)}" ${n === filter.name ? 'selected' : ''}>${escape(n)}</option>`).join('')}
      </select>
      <div class="segmented" role="group" aria-label="Filtrar por resultado">
        <button type="button" data-action="history-all" aria-pressed="${!filter.onlyFailed}">Todos</button>
        <button type="button" data-action="history-failed" aria-pressed="${filter.onlyFailed}">Com falha</button>
      </div>
      <span class="hint">Últimos 500 envios</span>
    </div>`;

  const list = visible.length === 0
    ? '<div class="empty"><p>Nenhum envio com esse filtro.</p></div>'
    : `<ul class="rows">${visible.map((d) => dispatchItem(d, { groupName, timeZone, now })).join('')}</ul>`;

  return filters + list;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/ui-views.test.js`
Expected: PASS

- [ ] **Step 5: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/schedules-view.js public/messages-view.js public/history-view.js test/fake-dom.js test/ui-views.test.js
git commit -m "HTML das abas, do painel lateral e dos modais da tela nova"
```

---

### Task 9: A tela nova

**Files:**
- Modify (reescritos): `public/index.html`, `public/style.css`, `public/app.js`
- Create: `public/main.js`
- Modify: `src/ui/server.js` (`STATIC_FILES`)
- Modify: `test/ui-server.test.js` (teste de módulos servidos)
- Modify (reescrito): `test/ui-app.test.js`

**Interfaces:**
- Consumes: tudo das Tasks 4 a 8; `GET /api/status` (Task 3).
- Produces: `app.js` exporta `state`, `start()`, `load()`, `refreshStatus({ quiet? })`, `openScheduleEditor(id?)`, `openMessageEditor(id?)`, `updatePreview(expr)`, `handleClick(evt)`, `handleInput(evt)`, `handleSubmit(evt)`. Nada roda ao importar; `main.js` chama `start()`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/ui-server.test.js`, troque o import de `node:fs` por `import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';` e acrescente, depois do teste `'recusa travessia de diretório nos estáticos'`:

```js
test('serve todos os módulos que a tela importa, como JavaScript', async (t) => {
  const call = await boot(t, newStore());
  // Segue os imports a partir do main.js: um módulo novo esquecido na lista
  // de estáticos quebraria a tela inteira no navegador sem nenhum teste falhar.
  const publicDir = new URL('../public/', import.meta.url);
  const files = new Set(['main.js']);
  const queue = ['main.js'];
  while (queue.length > 0) {
    const source = readFileSync(new URL(queue.shift(), publicDir), 'utf8');
    for (const [, name] of source.matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      if (!files.has(name)) {
        files.add(name);
        queue.push(name);
      }
    }
  }

  assert.ok(files.size >= 12, 'o main.js tem que alcançar todos os módulos da tela');
  for (const name of files) {
    const res = await call(`/${name}`);
    assert.equal(res.status, 200, `/${name} tem que ser servido`);
    assert.match(res.headers.get('content-type'), /text\/javascript/, name);
  }
});
```

Troque o conteúdo inteiro de `test/ui-app.test.js` por:

```js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/ui-app.test.js test/ui-server.test.js`
Expected: FAIL — `app.openScheduleEditor is not a function` (o `app.js` antigo não exporta nada) e `/main.js tem que ser servido`

- [ ] **Step 3: Implementar a lista de estáticos, o HTML e o ponto de entrada**

Em `src/ui/server.js`, troque a constante `STATIC_FILES` por:

```js
// Lista fixa: o caminho servido nunca é montado a partir da URL. Todo módulo
// que a tela importa precisa estar aqui (o teste de estáticos confere).
const JS = 'text/javascript; charset=utf-8';
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/main.js': ['main.js', JS],
  '/app.js': ['app.js', JS],
  '/api.js': ['api.js', JS],
  '/html.js': ['html.js', JS],
  '/cron.js': ['cron.js', JS],
  '/dates.js': ['dates.js', JS],
  '/whatsapp.js': ['whatsapp.js', JS],
  '/emoji.js': ['emoji.js', JS],
  '/history.js': ['history.js', JS],
  '/status-view.js': ['status-view.js', JS],
  '/schedules-view.js': ['schedules-view.js', JS],
  '/messages-view.js': ['messages-view.js', JS],
  '/history-view.js': ['history-view.js', JS],
};
```

`public/main.js`:

```js
// Ponto de entrada da tela: o app.js não executa nada sozinho ao ser importado.
import { start } from './app.js';

start();
```

`public/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>waha-scheduler</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div class="status-bar">
      <div id="status" class="status container"></div>
    </div>

    <div class="container">
      <header class="topbar">
        <h1 class="brand">waha-scheduler</h1>
        <nav class="tabs" aria-label="Seções">
          <button type="button" class="tab is-active" data-tab="schedules" aria-current="page">Agendamentos</button>
          <button type="button" class="tab" data-tab="messages">Mensagens</button>
          <button type="button" class="tab" data-tab="history">Histórico</button>
        </nav>
        <div id="primary-action" class="topbar-action"></div>
      </header>

      <main>
        <section id="schedules" aria-label="Agendamentos"></section>
        <section id="messages" aria-label="Mensagens" hidden></section>
        <section id="history" aria-label="Histórico" hidden></section>
      </main>
    </div>

    <dialog id="drawer" class="drawer" aria-labelledby="drawer-title"></dialog>
    <dialog id="modal" class="modal" aria-labelledby="modal-title"></dialog>
    <div id="toasts" class="toasts" aria-live="polite"></div>

    <script type="module" src="/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Reescrever `public/app.js`**

```js
// Tela de agendamentos: estado, carga, eventos, painel lateral e modais.
// Nada roda ao importar este arquivo: quem inicia a tela é o main.js. Assim
// os testes importam e chamam as funções com um document de mentira.

import { api } from './api.js';
import { escape, icon } from './html.js';
import { formatWhen } from './dates.js';
import { formatWhatsApp, toggleInline, toggleMonospace, toggleLinePrefix, insertText } from './whatsapp.js';
import { recentEmojis, rememberEmoji } from './emoji.js';
import { groupDispatches } from './history.js';
import { statusBar } from './status-view.js';
import {
  scheduleList, scheduleForm, formCron, formGroups, searchKey, selectedCountLabel, sendConfirm, sendResult,
} from './schedules-view.js';
import { messageList, messageForm, emojiPanel } from './messages-view.js';
import { historyView } from './history-view.js';

const STATUS_POLL_MS = 15_000;
const LOG_LIMIT = 500;
const TABS = ['schedules', 'messages', 'history'];
const EMPTY_PREVIEW = '<span class="muted">A prévia aparece aqui.</span>';

/** Estado da tela. Exportado para os testes. */
export const state = {
  schedules: [],
  messages: [],
  groups: [],
  groupsLoaded: false,
  groupsError: null,
  logs: [],
  status: null,
  statusError: null,
  // Diferença entre o relógio do servidor e o do navegador: "hoje" e
  // "amanhã" contam pelo relógio da máquina do agendador.
  clockOffset: 0,
  tab: 'schedules',
  // { type: 'schedule' | 'message', data, composing, snapshot }
  editing: null,
  sending: false,
  historyFilter: { name: '', onlyFailed: false },
  emojiTab: 'recent',
};

const $ = (selector) => document.querySelector(selector);
const drawer = () => $('#drawer');
const modal = () => $('#modal');
const now = () => Date.now() + state.clockOffset;
const timeZone = () => state.status?.timezone;
const groupName = (id) => state.groups.find((g) => g.id === id)?.name ?? id;
const fieldValue = (form, name) => form.querySelector(`[name="${name}"]`)?.value ?? '';

// ---------- Carga ----------

/**
 * Busca tudo da API e redesenha. O WAHA e o status podem falhar sem
 * derrubar o resto da tela.
 */
export async function load() {
  const [schedules, messages, logs] = await Promise.all([
    api('/schedules'),
    api('/messages'),
    api(`/logs?limit=${LOG_LIMIT}`),
  ]);
  Object.assign(state, { schedules, messages, logs });
  await refreshStatus({ quiet: true });
  render();
  await loadGroups();
}

async function reloadData() {
  const [schedules, messages] = await Promise.all([api('/schedules'), api('/messages')]);
  Object.assign(state, { schedules, messages });
  await refreshStatus({ quiet: true });
  render();
}

async function loadGroups() {
  try {
    state.groups = await api('/groups');
    state.groupsError = null;
  } catch (err) {
    state.groups = [];
    state.groupsError = err.message;
  }
  state.groupsLoaded = true;
  renderStatus();
  // O painel pode ter aberto antes da lista chegar, com o campo de ids
  // digitados. Se ninguém mexeu nele ainda, troca pela lista de grupos.
  if (state.editing?.type === 'schedule' && drawer().open && !isDirty()) renderScheduleDrawer({ fresh: true });
}

/**
 * Consulta o status do agendador. Sem `quiet`, redesenha a faixa e, se os
 * próximos envios mudaram (um disparo aconteceu), a aba e o histórico.
 * @param {{quiet?: boolean}} [options]
 */
export async function refreshStatus({ quiet = false } = {}) {
  const before = JSON.stringify(state.status?.nextRuns ?? null);
  try {
    const status = await api('/status');
    state.status = status;
    state.statusError = null;
    state.clockOffset = Date.parse(status.now) - Date.now();
  } catch (err) {
    state.statusError = err.message;
  }
  if (quiet) return;

  renderStatus();
  if (JSON.stringify(state.status?.nextRuns ?? null) !== before) {
    try {
      state.logs = await api(`/logs?limit=${LOG_LIMIT}`);
    } catch (err) {
      toast(`Não foi possível atualizar o histórico: ${err.message}`, 'error');
    }
    renderTab();
  }
}

// ---------- Desenho ----------

function render() {
  renderStatus();
  renderTabs();
  renderTab();
}

function renderStatus() {
  $('#status').innerHTML = statusBar({
    status: state.status,
    statusError: state.statusError,
    groupsError: state.groupsError,
    groupsLoaded: state.groupsLoaded,
    schedules: state.schedules,
    now: now(),
  });
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  for (const id of TABS) $(`#${id}`).hidden = id !== state.tab;

  const primary = {
    schedules: ['new-schedule', 'Novo agendamento'],
    messages: ['new-message', 'Nova mensagem'],
  }[state.tab];
  $('#primary-action').innerHTML = primary
    ? `<button type="button" class="btn btn-primary" data-action="${primary[0]}">${icon('plus')} ${primary[1]}</button>`
    : '';
}

function renderTab() {
  if (state.tab === 'schedules') {
    $('#schedules').innerHTML = scheduleList({
      schedules: state.schedules,
      messages: state.messages,
      nextRuns: state.status?.nextRuns,
      timeZone: timeZone(),
      now: now(),
    });
  } else if (state.tab === 'messages') {
    $('#messages').innerHTML = messageList({ messages: state.messages, schedules: state.schedules });
  } else {
    $('#history').innerHTML = historyView({
      dispatches: groupDispatches(state.logs),
      filter: state.historyFilter,
      groupName,
      timeZone: timeZone(),
      now: now(),
    });
  }
}

function toast(message, tone = 'ok') {
  const el = document.createElement('div');
  el.className = `toast tone-${tone}`;
  el.innerHTML = `<span>${escape(message)}</span>${tone === 'error'
    ? `<button type="button" class="icon-btn" data-action="dismiss-toast" aria-label="Fechar aviso">${icon('x')}</button>`
    : ''}`;
  // O aviso de sucesso some sozinho, pela animação do CSS; o de erro fica
  // até ser fechado.
  el.addEventListener('animationend', () => el.remove());
  $('#toasts').append(el);
}

// Erro de formulário aparece dentro do painel ou do modal, perto do botão.
// Se ele já fechou, vira aviso solto, mas nunca some.
function showFormError(container, message) {
  const el = container.querySelector('.form-error');
  if (!el) {
    toast(message, 'error');
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function hideFormError(container) {
  const el = container.querySelector('.form-error');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

// ---------- Painel lateral ----------

function snapshotOf(form) {
  return JSON.stringify([...form.querySelectorAll('input, select, textarea')]
    .map((el) => (el.type === 'checkbox' ? el.checked : el.value)));
}

function isDirty() {
  const form = drawer().querySelector('form');
  return Boolean(form && state.editing && snapshotOf(form) !== state.editing.snapshot);
}

function showDrawer(html, { fresh }) {
  const d = drawer();
  d.innerHTML = html;
  if (!d.open) d.showModal();
  if (fresh) state.editing.snapshot = snapshotOf(d.querySelector('form'));
}

function renderScheduleDrawer({ fresh = false } = {}) {
  showDrawer(scheduleForm({
    schedule: state.editing.data,
    messages: state.messages,
    groups: state.groups,
    groupsError: state.groupsError,
    composing: state.editing.composing,
    timezoneLabel: state.status?.timezoneLabel,
  }), { fresh });
  updatePreview(state.editing.data.cron ?? '');
}

/**
 * Abre o painel de agendamento: novo (sem id) ou edição.
 * @param {string} [id]
 */
export function openScheduleEditor(id) {
  const data = id
    ? structuredClone(state.schedules.find((s) => s.id === id))
    : { name: '', cron: '', messageId: state.messages[0]?.id, groups: [], enabled: true };
  state.editing = { type: 'schedule', data, composing: false, snapshot: '' };
  renderScheduleDrawer({ fresh: true });
}

/**
 * Abre o painel de mensagem: nova (sem id) ou edição.
 * @param {string} [id]
 */
export function openMessageEditor(id) {
  const data = id ? structuredClone(state.messages.find((m) => m.id === id)) : { name: '', text: '' };
  state.editing = { type: 'message', data, composing: false, snapshot: '' };
  showDrawer(messageForm({ message: data }), { fresh: true });
}

async function requestCloseDrawer() {
  if (isDirty()) {
    const discard = await confirmDialog({
      title: 'Descartar alterações?',
      body: 'O que você mudou neste formulário ainda não foi salvo.',
      confirm: 'Descartar',
      danger: true,
    });
    if (!discard) return;
  }
  closeDrawer();
}

function closeDrawer() {
  state.editing = null;
  const d = drawer();
  if (d.open) d.close();
  d.innerHTML = '';
}

// Guarda o que está no formulário antes de redesenhá-lo (trocar entre
// mensagem existente e nova), para não perder o que já foi digitado.
function captureScheduleForm() {
  const form = drawer().querySelector('form');
  const data = state.editing.data;
  data.name = fieldValue(form, 'name');
  data.cron = formCron(form);
  data.groups = formGroups(form);
  const messageId = fieldValue(form, 'messageId');
  if (messageId) data.messageId = messageId;
}

// Token da última chamada em voo: a resposta de uma digitação antiga (rede
// lenta) não pode sobrescrever a prévia de uma digitação mais nova.
let previewToken = 0;

/**
 * Atualiza os próximos envios mostrados no formulário aberto.
 * @param {string} expr Cron que o formulário representa agora.
 */
export async function updatePreview(expr) {
  const el = drawer().querySelector('#preview');
  if (!el) return;
  const token = ++previewToken;

  if (!expr.trim()) {
    el.className = 'preview';
    el.textContent = 'Marque os dias e o horário para ver os próximos envios.';
    return;
  }

  try {
    const { valid, next, reason } = await api(`/cron/preview?expr=${encodeURIComponent(expr)}`);
    if (token !== previewToken) return;
    el.className = valid ? 'preview' : 'preview invalid';
    if (!valid) {
      // "reason" só vem quando a expressão passa na checagem estática mas o
      // node-cron recusa registrá-la: é a única pista do porquê.
      el.textContent = reason ? `Expressão cron inválida: ${reason}` : 'Expressão cron inválida';
    } else if (next.length === 0) {
      el.textContent = 'Nenhum envio previsto';
    } else {
      const when = next.map((d) => formatWhen(d, { timeZone: timeZone(), now: now() }));
      el.textContent = `Próximos envios: ${when.join(' · ')}`;
    }
  } catch (err) {
    if (token !== previewToken) return;
    // A falha não pode deixar os horários da expressão ANTERIOR parecendo
    // válidos ao lado de uma expressão nova.
    el.className = 'preview invalid';
    el.textContent = `Não foi possível calcular os próximos envios: ${err.message}`;
  }
}

function setDays(form, days) {
  form.querySelectorAll('input[name="day"]').forEach((input) => {
    input.checked = days.includes(Number(input.value));
  });
  updatePreview(formCron(form));
}

function filterGroups(input) {
  const query = searchKey(input.value.trim());
  input.form.querySelectorAll('.group').forEach((label) => {
    label.hidden = query !== '' && !label.dataset.name.includes(query);
  });
}

function updateGroupCount(form) {
  const counter = form.querySelector('#groups-count');
  if (counter) counter.textContent = selectedCountLabel(form.querySelectorAll('input[name="group"]:checked').length);
}

function updateMessagePreview(select) {
  const message = state.messages.find((m) => m.id === select.value);
  const preview = select.form.querySelector('#message-preview');
  if (preview) preview.innerHTML = message ? formatWhatsApp(message.text) : '';
}

// ---------- Editor de mensagem ----------

function updateEditorPreview(textarea) {
  const preview = textarea.closest('.editor').querySelector('[data-role="editor-preview"]');
  preview.innerHTML = textarea.value.trim() ? formatWhatsApp(textarea.value) : EMPTY_PREVIEW;
}

// Troca o texto do campo mantendo o desfazer (⌘Z) do navegador quando dá:
// execCommand('insertText') entra no histórico de edição; atribuir .value não.
function replaceText(textarea, { text, start, end }) {
  textarea.focus();
  textarea.setSelectionRange(0, textarea.value.length);
  if (!document.execCommand?.('insertText', false, text)) textarea.value = text;
  textarea.setSelectionRange(start, end);
  updateEditorPreview(textarea);
}

function applyFormat(button) {
  const editor = button.closest('.editor');
  if (button.dataset.format === 'emoji') {
    toggleEmojiPanel(editor);
    return;
  }
  const textarea = editor.querySelector('textarea[data-editor]');
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const formats = {
    bold: () => toggleInline(value, start, end, '*'),
    italic: () => toggleInline(value, start, end, '_'),
    strike: () => toggleInline(value, start, end, '~'),
    mono: () => toggleMonospace(value, start, end),
    bullet: () => toggleLinePrefix(value, start, end, 'bullet'),
    numbered: () => toggleLinePrefix(value, start, end, 'numbered'),
    quote: () => toggleLinePrefix(value, start, end, 'quote'),
  };
  replaceText(textarea, formats[button.dataset.format]());
}

// O localStorage pode lançar só por ser acessado (navegador bloqueando dados
// do site). Sem ele, a aba Recentes fica vazia; o resto funciona.
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function renderEmojiPanel(panel) {
  panel.innerHTML = emojiPanel({ active: state.emojiTab, recents: recentEmojis(storage()) });
}

function toggleEmojiPanel(editor) {
  const panel = editor.querySelector('[data-role="emoji-panel"]');
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  // Na primeira vez não há recentes: abre direto nos rostos.
  if (state.emojiTab === 'recent' && recentEmojis(storage()).length === 0) state.emojiTab = 'faces';
  renderEmojiPanel(panel);
  panel.hidden = false;
}

function pickEmoji(button) {
  const textarea = button.closest('.editor').querySelector('textarea[data-editor]');
  const emoji = button.dataset.emoji;
  rememberEmoji(storage(), emoji);
  replaceText(textarea, insertText(textarea.value, textarea.selectionStart, textarea.selectionEnd, emoji));
}

// ---------- Modais ----------

// Confirmação da tela, no lugar do confirm() do navegador. Resolve true só no
// botão de confirmar; Esc, clique fora e Cancelar resolvem false.
function confirmDialog({ title, body, confirm, danger = false }) {
  const m = modal();
  m.innerHTML = `
    <form method="dialog" class="modal-box">
      <h2 id="modal-title">${escape(title)}</h2>
      <p class="modal-text">${escape(body)}</p>
      <div class="modal-actions">
        <button type="submit" value="cancel" class="btn">Cancelar</button>
        <button type="submit" value="confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escape(confirm)}</button>
      </div>
    </form>`;
  m.returnValue = '';
  return new Promise((resolve) => {
    m.addEventListener('close', () => resolve(m.returnValue === 'confirm'), { once: true });
    m.showModal();
  });
}

function openSendModal(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  const message = state.messages.find((m) => m.id === schedule.messageId);
  const m = modal();
  m.innerHTML = sendConfirm({ schedule, message, groupName });
  m.returnValue = '';
  m.showModal();
}

async function confirmSend(button, id) {
  const m = modal();
  const schedule = state.schedules.find((s) => s.id === id);
  const cancel = m.querySelector('[data-action="close-modal"]');
  const label = button.innerHTML;
  // Um envio com vários grupos e intervalo entre eles pode levar dezenas de
  // segundos: o modal fica travado para um clique impaciente não mandar duas
  // vezes. Fila e retry são proibidos no projeto; a defesa é da tela.
  state.sending = true;
  button.disabled = true;
  cancel.disabled = true;
  button.textContent = 'Enviando…';
  hideFormError(m);

  let result;
  try {
    result = await api(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
  } catch (err) {
    button.disabled = false;
    cancel.disabled = false;
    button.innerHTML = label;
    showFormError(m, err.message);
    return;
  } finally {
    state.sending = false;
  }

  m.innerHTML = sendResult({ schedule, result, groupName });
  try {
    state.logs = await api(`/logs?limit=${LOG_LIMIT}`);
    if (state.tab === 'history') renderTab();
  } catch (err) {
    toast(`Não foi possível atualizar o histórico: ${err.message}`, 'error');
  }
}

// ---------- Ações ----------

async function guarded(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleSchedule(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  await api(`/schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: !schedule.enabled }),
  });
  toast(schedule.enabled ? `"${schedule.name}" pausado` : `"${schedule.name}" ativado`);
  await reloadData();
}

async function deleteSchedule(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  const ok = await confirmDialog({
    title: `Excluir "${schedule.name}"?`,
    body: 'O agendamento sai da lista e para de enviar. A mensagem continua na aba Mensagens.',
    confirm: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  await api(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast(`Agendamento "${schedule.name}" excluído`);
  await reloadData();
}

async function deleteMessage(id) {
  const message = state.messages.find((m) => m.id === id);
  const ok = await confirmDialog({
    title: `Excluir "${message.name}"?`,
    body: 'A mensagem sai da biblioteca. Se algum agendamento usa ela, a exclusão é recusada.',
    confirm: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  await api(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast(`Mensagem "${message.name}" excluída`);
  await reloadData();
}

async function persistSchedule(data) {
  const payload = { name: data.name, cron: data.cron, messageId: data.messageId, groups: data.groups };
  if (data.id) {
    await api(`/schedules/${encodeURIComponent(data.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...payload, enabled: data.enabled }),
    });
  } else {
    await api('/schedules', { method: 'POST', body: JSON.stringify(payload) });
  }
}

async function saveSchedule(form) {
  // O horário e o cron cru já são obrigatórios no próprio campo; o que o
  // navegador não barra é nenhum dia marcado.
  const cron = formCron(form);
  if (!cron) throw new Error('Selecione ao menos um dia da semana e o horário.');
  const groups = formGroups(form);
  // A API recusa lista vazia com 400. Barrar aqui evita a ida e volta e
  // deixa claro que desmarcar tudo não significa "herda os defaults".
  if (groups.length === 0) throw new Error('Selecione ao menos um grupo de destino.');

  const editing = state.editing;
  editing.data = { ...editing.data, name: fieldValue(form, 'name'), cron, groups };

  if (form.querySelector('[name="messageText"]')) {
    // "Escrever nova": grava a mensagem primeiro. Se o agendamento for
    // recusado depois, o painel volta com ela já escolhida, e tentar de novo
    // não cria outra.
    const created = await api('/messages', {
      method: 'POST',
      body: JSON.stringify({ name: fieldValue(form, 'messageName'), text: fieldValue(form, 'messageText') }),
    });
    state.messages = [...state.messages, created];
    editing.data.messageId = created.id;
    editing.composing = false;
    try {
      await persistSchedule(editing.data);
    } catch (err) {
      renderScheduleDrawer();
      throw err;
    }
  } else {
    editing.data.messageId = fieldValue(form, 'messageId');
    await persistSchedule(editing.data);
  }

  const name = editing.data.name.trim();
  closeDrawer();
  toast(`Agendamento "${name}" salvo`);
  await reloadData();
}

async function saveMessage(form) {
  const payload = { name: fieldValue(form, 'name'), text: fieldValue(form, 'text') };
  const id = state.editing.data.id;
  await api(id ? `/messages/${encodeURIComponent(id)}` : '/messages', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  closeDrawer();
  toast(`Mensagem "${payload.name.trim()}" salva`);
  await reloadData();
}

// ---------- Eventos ----------

// Fecha o que flutua (menu "⋯", seletor de emojis) quando o clique é fora dele.
function closeFloating(target) {
  document.querySelectorAll('details.menu[open]').forEach((menu) => {
    if (!menu.contains(target)) menu.open = false;
  });
  document.querySelectorAll('[data-role="emoji-panel"]:not([hidden])').forEach((panel) => {
    if (!panel.parentElement.contains(target)) panel.hidden = true;
  });
}

/**
 * Delegação de cliques da tela inteira. Exportado para os testes.
 * @param {MouseEvent} evt
 */
export function handleClick(evt) {
  const target = evt.target;
  if (typeof target?.closest !== 'function') return;
  closeFloating(target);

  const tab = target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    renderTabs();
    renderTab();
    return;
  }

  const format = target.closest('[data-format]');
  if (format) {
    applyFormat(format);
    return;
  }

  const emojiTab = target.closest('[data-emoji-tab]');
  if (emojiTab) {
    state.emojiTab = emojiTab.dataset.emojiTab;
    renderEmojiPanel(emojiTab.closest('[data-role="emoji-panel"]'));
    return;
  }

  const emoji = target.closest('[data-emoji]');
  if (emoji) {
    pickEmoji(emoji);
    return;
  }

  const el = target.closest('[data-action]');
  if (!el || el.disabled) return;
  el.closest('details.menu')?.removeAttribute('open');
  const { action, id } = el.dataset;

  const actions = {
    'new-schedule': () => openScheduleEditor(),
    edit: () => openScheduleEditor(id),
    'new-message': () => openMessageEditor(),
    'edit-message': () => openMessageEditor(id),
    'close-drawer': () => requestCloseDrawer(),
    'close-modal': () => modal().close(),
    'compose-message': () => {
      captureScheduleForm();
      state.editing.composing = true;
      renderScheduleDrawer();
    },
    'pick-message': () => {
      captureScheduleForm();
      state.editing.composing = false;
      renderScheduleDrawer();
    },
    'days-weekdays': () => setDays(el.form, [1, 2, 3, 4, 5]),
    'days-all': () => setDays(el.form, [0, 1, 2, 3, 4, 5, 6]),
    toggle: () => guarded(() => toggleSchedule(id)),
    run: () => openSendModal(id),
    'confirm-send': () => confirmSend(el, id),
    'delete-schedule': () => guarded(() => deleteSchedule(id)),
    'delete-message': () => guarded(() => deleteMessage(id)),
    'history-all': () => {
      state.historyFilter.onlyFailed = false;
      renderTab();
    },
    'history-failed': () => {
      state.historyFilter.onlyFailed = true;
      renderTab();
    },
    'dismiss-toast': () => el.closest('.toast')?.remove(),
  };
  actions[action]?.();
}

/**
 * Delegação de digitação. Exportado para os testes.
 * @param {InputEvent} evt
 */
export function handleInput(evt) {
  const target = evt.target;
  if (['day', 'time', 'cron'].includes(target.name)) {
    updatePreview(formCron(target.form));
  } else if (target.dataset?.editor !== undefined) {
    updateEditorPreview(target);
  } else if (target.dataset?.role === 'group-search') {
    filterGroups(target);
  }
}

function handleChange(evt) {
  const target = evt.target;
  if (target.name === 'group') {
    updateGroupCount(target.form);
  } else if (target.name === 'messageId') {
    updateMessagePreview(target);
  } else if (target.dataset?.role === 'history-name') {
    state.historyFilter.name = target.value;
    renderTab();
  }
}

function handleKeydown(evt) {
  const target = evt.target;
  if (target.dataset?.editor === undefined || !(evt.metaKey || evt.ctrlKey)) return;
  const key = evt.key.toLowerCase();
  if (key !== 'b' && key !== 'i') return;
  evt.preventDefault();
  replaceText(target, toggleInline(target.value, target.selectionStart, target.selectionEnd, key === 'b' ? '*' : '_'));
}

/**
 * Envio dos formulários do painel. Exportado para os testes.
 * @param {SubmitEvent} evt
 */
export async function handleSubmit(evt) {
  const form = evt.target;
  // Formulário de modal (method="dialog") fecha sozinho com o valor do botão.
  if (form.getAttribute('method') === 'dialog') return;
  evt.preventDefault();

  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  hideFormError(drawer());
  try {
    if (form.id === 'form-schedule') await saveSchedule(form);
    else if (form.id === 'form-message') await saveMessage(form);
  } catch (err) {
    showFormError(drawer(), err.message);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
}

/** Liga os eventos, busca os dados e passa a acompanhar o status do agendador. */
export function start() {
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', handleKeydown);

  const d = drawer();
  // Esc fecha primeiro o seletor de emojis; depois pede para fechar o
  // painel, perguntando se há alteração não salva.
  d.addEventListener('cancel', (evt) => {
    evt.preventDefault();
    const panel = d.querySelector('[data-role="emoji-panel"]:not([hidden])');
    if (panel) panel.hidden = true;
    else requestCloseDrawer();
  });
  // Clique no fundo escurecido: o alvo é o próprio <dialog>, não o conteúdo.
  d.addEventListener('click', (evt) => {
    if (evt.target === d) requestCloseDrawer();
  });
  // Se o navegador fechar o painel por conta própria, a edição acabou.
  d.addEventListener('close', () => {
    state.editing = null;
  });

  const m = modal();
  m.addEventListener('cancel', (evt) => {
    if (state.sending) evt.preventDefault();
  });
  m.addEventListener('click', (evt) => {
    if (evt.target === m && !state.sending) m.close();
  });

  setInterval(() => refreshStatus(), STATUS_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });

  load().catch((err) => toast(`Não foi possível carregar a tela: ${err.message}`, 'error'));
}
```

- [ ] **Step 5: Reescrever `public/style.css`**

```css
/* Tela de agendamentos. Paleta neutra: cor só com significado — verde é
   rodando, ativo ou enviado; vermelho é perigo ou falha; âmbar é atenção. */

:root {
  color-scheme: light dark;
  --bg: #f7f7f5;
  --surface: #ffffff;
  --surface-2: #f0efeb;
  --text: #1d1d1b;
  --text-2: #5c5b57;
  --text-3: #8b8a84;
  --border: rgba(0, 0, 0, 0.1);
  --border-strong: rgba(0, 0, 0, 0.2);
  --ok: #2e7d32;
  --danger: #b42318;
  --danger-bg: #fbeae8;
  --warn: #8a5300;
  --on-fill: #ffffff;
  --backdrop: rgba(20, 20, 18, 0.4);
  --shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
  --radius: 8px;
  --radius-lg: 12px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514;
    --surface: #1e1e1d;
    --surface-2: #272725;
    --text: #ececea;
    --text-2: #a9a8a2;
    --text-3: #7c7b76;
    --border: rgba(255, 255, 255, 0.1);
    --border-strong: rgba(255, 255, 255, 0.2);
    --ok: #74c378;
    --danger: #f28b82;
    --danger-bg: #3b1c1a;
    --warn: #e6b45c;
    --on-fill: #151514;
    --backdrop: rgba(0, 0, 0, 0.6);
    --shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
}

/* ---------- Base ---------- */

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
button, input, select, textarea { font: inherit; color: inherit; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
code, pre { font-family: var(--mono); font-size: 0.9em; }
.icon { width: 1.05em; height: 1.05em; flex: none; vertical-align: -0.15em; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}
.container { max-width: 68rem; margin: 0 auto; padding: 0 1.25rem; }
.muted { color: var(--text-3); }
.hint { margin: 0; font-size: 0.8rem; color: var(--text-2); }
.note { margin: 0; font-size: 0.85rem; color: var(--text-2); }
.text-danger { color: var(--danger); font-size: 0.85rem; }

/* ---------- Faixa de status ---------- */

.status-bar { background: var(--surface-2); border-bottom: 1px solid var(--border); }
.status {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 1.25rem;
  padding-top: 0.55rem; padding-bottom: 0.55rem; font-size: 0.85rem; color: var(--text-2);
}
.status-item { display: inline-flex; align-items: baseline; gap: 0.45rem; }
.status-item .dot {
  width: 0.5rem; height: 0.5rem; border-radius: 50%; flex: none;
  background: var(--text-3); transform: translateY(-0.05rem);
}
.status-item.tone-ok .dot { background: var(--ok); }
.status-item.tone-warn .dot { background: var(--warn); }
.status-item.tone-danger .dot { background: var(--danger); }
.status-item.tone-warn { color: var(--warn); font-weight: 600; }
.status-item.tone-danger { color: var(--danger); font-weight: 600; }
.status-detail { font-weight: 400; color: var(--text-2); }
.status-detail::before { content: " · "; }
.status-next { margin-left: auto; display: inline-flex; align-items: center; gap: 0.4rem; }

/* ---------- Topo e abas ---------- */

.topbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.5rem;
  padding: 1.1rem 0 0; border-bottom: 1px solid var(--border);
}
.brand { margin: 0 0 0.6rem; font-size: 1.05rem; font-weight: 650; letter-spacing: -0.01em; }
.tabs { display: flex; gap: 0.25rem; overflow-x: auto; align-self: flex-end; }
.tab {
  background: none; border: 0; border-bottom: 2px solid transparent;
  padding: 0.45rem 0.7rem 0.6rem; color: var(--text-2); cursor: pointer; white-space: nowrap;
}
.tab:hover { color: var(--text); }
.tab.is-active { color: var(--text); font-weight: 600; border-bottom-color: var(--text); }
.topbar-action { margin: 0 0 0.6rem auto; }
main { padding: 1.25rem 0 3rem; }

/* ---------- Botões ---------- */

.btn {
  display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; line-height: 1.3;
  padding: 0.45rem 0.85rem; border-radius: var(--radius);
  border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer;
}
.btn:hover { background: var(--surface-2); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: var(--text); border-color: var(--text); color: var(--surface); font-weight: 550; }
.btn-primary:hover { background: var(--text); opacity: 0.88; }
.btn-danger { background: var(--danger); border-color: var(--danger); color: var(--on-fill); font-weight: 550; }
.btn-danger:hover { background: var(--danger); opacity: 0.88; }
.btn-danger-outline { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.btn-danger-outline:hover { background: var(--danger-bg); }
.btn-sm { padding: 0.3rem 0.6rem; font-size: 0.85rem; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 2rem; height: 2rem; border-radius: var(--radius); border: 0;
  background: none; color: var(--text-2); cursor: pointer;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.icon-btn.danger:hover { color: var(--danger); background: var(--danger-bg); }
.link {
  background: none; border: 0; padding: 0; cursor: pointer; font-size: 0.85rem;
  color: var(--text-2); text-decoration: underline; text-underline-offset: 2px;
}
.link:hover { color: var(--text); }

/* ---------- Listas ---------- */

.rows {
  list-style: none; margin: 0; padding: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.rows > li { border-bottom: 1px solid var(--border); }
.rows > li:last-child { border-bottom: 0; }
.row { display: grid; align-items: center; gap: 0.5rem 1rem; padding: 0.85rem 1rem; }
.schedule-row { grid-template-columns: auto minmax(0, 1fr) 12rem 5.5rem auto; }
.message-row { grid-template-columns: minmax(0, 1fr) 14rem auto; }
.row-main { min-width: 0; }
.row-title {
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
  font-weight: 600; overflow-wrap: anywhere;
}
.row-title:hover { text-decoration: underline; text-underline-offset: 2px; }
.row-sub, .row-next, .row-count { color: var(--text-2); font-size: 0.85rem; }
.row-next strong { color: var(--text); font-weight: 550; }
.row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem; }
.is-paused .row-title, .is-paused .row-sub { color: var(--text-3); }
.message-snippet {
  margin-top: 0.15rem; color: var(--text-2); font-size: 0.85rem;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.message-snippet > div { display: inline; }
.message-snippet > div + div::before { content: " "; }

.switch {
  position: relative; flex: none; width: 2.1rem; height: 1.25rem; padding: 0;
  border: 0; border-radius: 999px; background: var(--border-strong); cursor: pointer;
}
.switch::after {
  content: ""; position: absolute; top: 0.15rem; left: 0.15rem;
  width: 0.95rem; height: 0.95rem; border-radius: 50%;
  background: var(--surface); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s ease;
}
.switch[aria-checked="true"] { background: var(--ok); }
.switch[aria-checked="true"]::after { transform: translateX(0.85rem); }

.menu { position: relative; }
.menu > summary { list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.menu-items {
  position: absolute; right: 0; top: calc(100% + 0.25rem); z-index: 5; min-width: 10rem;
  padding: 0.3rem; background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: var(--radius); box-shadow: var(--shadow);
}
.menu-items button {
  display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left;
  padding: 0.45rem 0.6rem; border: 0; border-radius: 6px; background: none; cursor: pointer;
}
.menu-items button:hover { background: var(--surface-2); }
.menu-items .danger { color: var(--danger); }

.empty {
  text-align: center; padding: 3rem 1rem; color: var(--text-2);
  background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--radius-lg);
}
.empty p { margin: 0; }
.empty-title { font-size: 1.05rem; font-weight: 600; color: var(--text); margin-bottom: 0.25rem !important; }
.empty .btn { margin-top: 1rem; }

/* ---------- Painel lateral ---------- */

dialog { color: var(--text); }
dialog::backdrop { background: var(--backdrop); }
.drawer {
  margin: 0 0 0 auto; padding: 0; border: 0;
  width: min(42rem, 100vw); max-width: 100vw; height: 100dvh; max-height: 100dvh;
  background: var(--surface); box-shadow: var(--shadow);
}
.drawer[open] { animation: drawer-in 0.18s ease-out; }
@keyframes drawer-in { from { transform: translateX(2rem); opacity: 0; } }
.drawer-form { display: flex; flex-direction: column; height: 100%; }
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--border);
}
.drawer-header h2 { margin: 0; font-size: 1.1rem; }
.drawer-body { flex: 1; overflow-y: auto; padding: 1.25rem; display: grid; gap: 1.5rem; align-content: start; }
.drawer-footer {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5rem;
  padding: 0.85rem 1.25rem; border-top: 1px solid var(--border); background: var(--surface-2);
}
.form-error { flex-basis: 100%; margin: 0; color: var(--danger); font-size: 0.85rem; }

.field { position: relative; display: grid; gap: 0.45rem; min-width: 0; margin: 0; padding: 0; border: 0; }
.field-label { padding: 0; font-size: 0.8rem; font-weight: 600; color: var(--text-2); }
legend.field-label { margin-bottom: 0.45rem; }
.field-aside { position: absolute; top: 0; right: 0; font-size: 0.8rem; color: var(--text-2); }
input[type="text"], input[type="search"], input[type="time"], select, textarea {
  width: 100%; padding: 0.5rem 0.65rem; border: 1px solid var(--border-strong);
  border-radius: var(--radius); background: var(--surface);
}
.preview.invalid { color: var(--danger); }

.days { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.day { position: relative; }
.day input { position: absolute; opacity: 0; pointer-events: none; }
.day span {
  display: inline-flex; justify-content: center; min-width: 2.9rem; padding: 0.35rem 0.5rem;
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  font-size: 0.85rem; cursor: pointer; user-select: none;
}
.day input:checked + span { background: var(--text); border-color: var(--text); color: var(--surface); }
.day input:focus-visible + span { outline: 2px solid var(--text); outline-offset: 2px; }
.when-row { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
.when-row .time { margin-left: auto; }
.when-row input[type="time"] { width: auto; }

.group-list {
  display: grid; gap: 0.1rem; max-height: 16rem; overflow-y: auto; padding: 0.3rem;
  border: 1px solid var(--border); border-radius: var(--radius);
}
.group { display: flex; align-items: center; gap: 0.55rem; padding: 0.4rem 0.45rem; border-radius: 6px; cursor: pointer; }
.group:hover { background: var(--surface-2); }
.group input { width: 1rem; height: 1rem; flex: none; accent-color: var(--text); }
.group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-id { color: var(--text-3); font-size: 0.75rem; }
.group-missing, .group-missing .group-name { color: var(--danger); }
.group-missing input { accent-color: var(--danger); }
.group-missing .warn { font-size: 0.75rem; font-weight: 600; }

/* ---------- Mensagem: balão, editor e emojis ---------- */

.chat { background: var(--surface-2); border-radius: var(--radius-lg); padding: 0.75rem; }
.bubble {
  max-width: 26rem; padding: 0.55rem 0.75rem; font-size: 0.9rem; line-height: 1.5; overflow-wrap: anywhere;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
}
.bubble code, .bubble pre { background: var(--surface-2); border-radius: 4px; padding: 0 0.25rem; }
.bubble pre { margin: 0.25rem 0; white-space: pre-wrap; }
.wa-quote { margin: 0.15rem 0; padding-left: 0.5rem; border-left: 3px solid var(--border-strong); color: var(--text-2); }
.wa-li { display: flex; gap: 0.4rem; }
.wa-mark { flex: none; }

.editor { display: grid; gap: 0.9rem; }
.editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.9rem; align-items: start; }
.editor-input { position: relative; }
.editor-preview { display: grid; gap: 0.4rem; }
.toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.1rem; padding: 0.25rem;
  background: var(--surface-2); border: 1px solid var(--border-strong); border-bottom: 0;
  border-radius: var(--radius) var(--radius) 0 0;
}
.toolbar + textarea {
  border-radius: 0 0 var(--radius) var(--radius); resize: vertical; min-height: 11rem;
  font-family: var(--mono); font-size: 0.85rem; line-height: 1.6;
}
.tool {
  display: inline-flex; align-items: center; justify-content: center; width: 1.9rem; height: 1.8rem;
  border: 0; border-radius: 6px; background: none; color: var(--text-2); cursor: pointer;
}
.tool:hover { background: var(--surface); color: var(--text); }
.tool-sep { width: 1px; height: 1rem; margin: 0 0.2rem; background: var(--border-strong); }
.emoji-panel {
  position: absolute; left: 0; right: 0; top: 2.4rem; z-index: 6; padding: 0.5rem;
  background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); box-shadow: var(--shadow);
}
.emoji-tabs {
  display: flex; gap: 0.15rem; overflow-x: auto;
  margin-bottom: 0.35rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--border);
}
.emoji-tabs button {
  padding: 0.25rem 0.5rem; border: 0; border-radius: 6px; background: none;
  color: var(--text-2); font-size: 0.8rem; white-space: nowrap; cursor: pointer;
}
.emoji-tabs button[aria-selected="true"] { background: var(--surface-2); color: var(--text); font-weight: 600; }
.emoji-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(2.1rem, 1fr)); gap: 0.1rem;
  max-height: 12rem; overflow-y: auto;
}
.emoji { padding: 0.3rem; border: 0; border-radius: 6px; background: none; font-size: 1.3rem; line-height: 1; cursor: pointer; }
.emoji:hover { background: var(--surface-2); }

/* ---------- Modal ---------- */

.modal {
  width: min(30rem, calc(100vw - 2rem)); padding: 0; border: 0;
  border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow);
}
.modal-box { display: grid; gap: 0.85rem; padding: 1.25rem; }
.modal-box h2 { margin: 0; font-size: 1.1rem; }
.modal-text { margin: 0; color: var(--text-2); }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.chip { padding: 0.15rem 0.6rem; border-radius: 999px; background: var(--surface-2); font-size: 0.8rem; }
.failures { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; color: var(--danger); font-size: 0.9rem; }
.failures li { display: flex; align-items: baseline; gap: 0.4rem; }

/* ---------- Avisos ---------- */

.toasts {
  position: fixed; right: 1rem; bottom: 1rem; z-index: 50;
  display: grid; gap: 0.5rem; max-width: min(24rem, calc(100vw - 2rem));
}
.toast {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.85rem; font-size: 0.9rem;
  background: var(--text); color: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
}
/* O de sucesso some sozinho: o app.js remove o aviso no fim desta animação. */
.toast.tone-ok { animation: toast-out 0.3s ease 4s forwards; }
.toast.tone-error {
  background: var(--danger-bg); color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
}
.toast .icon-btn { width: 1.6rem; height: 1.6rem; color: inherit; }
@keyframes toast-out { to { opacity: 0; transform: translateY(0.5rem); } }

/* ---------- Histórico ---------- */

.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
.filters select { width: auto; }
.filters .hint { margin-left: auto; }
.segmented { display: inline-flex; overflow: hidden; border: 1px solid var(--border-strong); border-radius: var(--radius); }
.segmented button { padding: 0.4rem 0.8rem; border: 0; background: var(--surface); font-size: 0.85rem; cursor: pointer; }
.segmented button + button { border-left: 1px solid var(--border-strong); }
.segmented button[aria-pressed="true"] { background: var(--text); color: var(--surface); }
.dispatch > summary { list-style: none; cursor: pointer; grid-template-columns: auto minmax(0, 1fr) auto 9rem auto; }
.dispatch > summary::-webkit-details-marker { display: none; }
.dispatch-icon { display: inline-flex; font-size: 1.1rem; }
.dispatch-icon.tone-ok { color: var(--ok); }
.dispatch-icon.tone-danger { color: var(--danger); }
.row-title-text { font-weight: 600; }
.tag {
  margin-left: 0.5rem; padding: 0 0.45rem; font-size: 0.72rem; vertical-align: 0.1em;
  color: var(--text-2); border: 1px solid var(--border-strong); border-radius: 999px;
}
.chevron { display: inline-flex; color: var(--text-3); transition: transform 0.15s ease; }
.dispatch[open] .chevron { transform: rotate(180deg); }
.dispatch-entries { display: grid; gap: 0.3rem; margin: 0; padding: 0 1rem 0.85rem 3rem; list-style: none; font-size: 0.85rem; }
.dispatch-entries li { display: flex; align-items: baseline; gap: 0.5rem; }
.dispatch-entries li:not(.text-danger) .icon { color: var(--ok); }
.entry-time { margin-left: auto; color: var(--text-3); font-variant-numeric: tabular-nums; }

/* ---------- Tela estreita e movimento reduzido ---------- */

@media (max-width: 720px) {
  .schedule-row { grid-template-columns: auto minmax(0, 1fr); }
  .schedule-row .row-next, .schedule-row .row-count { grid-column: 2; }
  .schedule-row .row-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .message-row { grid-template-columns: minmax(0, 1fr) auto; }
  .message-row .row-sub { grid-column: 1; }
  .dispatch > summary { grid-template-columns: auto minmax(0, 1fr) auto; }
  .dispatch-count, .dispatch-when { grid-column: 2; }
  .editor-grid { grid-template-columns: minmax(0, 1fr); }
  .status-next { margin-left: 0; }
  .topbar-action { margin-left: 0; width: 100%; }
  .filters .hint { margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .drawer[open] { animation: none; }
  .switch::after, .chevron { transition: none; }
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `node --test test/ui-app.test.js test/ui-server.test.js`
Expected: PASS

- [ ] **Step 7: Regressão e commit**

```bash
npm test && node harness/run.js all
git add public/index.html public/style.css public/app.js public/main.js src/ui/server.js test/ui-app.test.js test/ui-server.test.js
git commit -m "Tela nova: faixa de status, painel lateral, editor de mensagem e histórico por disparo"
```

---

### Task 10: Documentação

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-11-frontend-redesign-design.md`, `docs/superpowers/specs/2026-09-06-frontend-agendamentos-design.md`

- [ ] **Step 1: README**

Em "Tela de agendamentos", depois do parágrafo que termina em "é mantido como está ao salvar.", acrescente:

```markdown
No topo, uma faixa mostra se o agendador (`npm start`) está rodando, se o
WAHA respondeu e qual é o próximo envio. É ela que avisa quando um agendamento
não vai sair porque o agendador está parado. O agendador grava um sinal de vida
a cada 15 segundos em `scheduler-status.json`, na mesma pasta do arquivo de
agendamentos; sem sinal há mais de 45 segundos, a tela mostra que ele parou de
responder. Todas as datas da tela seguem o fuso de `TIMEZONE`.

As mensagens aceitam a formatação do WhatsApp (`*negrito*`, `_itálico_`,
`~tachado~`, `` `código` ``, bloco entre três crases, listas com `-` ou `1.` e
citação com `>`) e emojis, pela barra do editor. O texto é guardado e enviado
cru, com os marcadores; a prévia ao lado mostra como ele chega no grupo. Um
agendamento novo pode ter a mensagem escrita ali mesmo, em "Escrever nova".
```

No parágrafo seguinte que começa com `O botão "Disparar agora"`, troque `"Disparar agora"` por `"Enviar agora"`.

Em "Estrutura", depois de `src/index.js         Processo do agendador`, acrescente `src/scheduler-status.js  Status do agendador, lido pela tela`, e troque a linha de `public/` por `public/              A tela (HTML, CSS e módulos JS nativos, sem build)`.

- [ ] **Step 2: Specs**

No spec novo, alinhe o texto ao que foi implementado:
- Status muda de `em revisão pelo usuário` para `aprovado e implementado`.
- Onde diz "Ícones: cerca de 20 SVGs do Tabler Icons (licença MIT, aviso no arquivo)", troque por "Ícones: 19 SVGs do Lucide (licença ISC, aviso no arquivo)".
- Na decisão R3 e em "Visual", troque "Tabler" por "Lucide".
- Na tabela de módulos, acrescente a linha `| status-view.js | faixa de status: aviso do agendador, WAHA e próximo envio | não |`.
- Em "Status do agendador", troque a descrição de `readStatus` por: "devolve o objeto, ou `null` se o arquivo não existe. JSON inválido lança erro com o caminho; a rota loga e mostra o agendador como parado."
- Em "Impacto no código existente", acrescente `| .gitignore | scheduler-status.json fora do versionamento em qualquer pasta |` e `status-view` na lista de `public/*.js`.

No spec de 2026-09-06, logo abaixo da linha `Status: aprovado para planejamento`, acrescente:

```markdown

> A seção "A tela" foi substituída por `2026-09-11-frontend-redesign-design.md`.
> O resto deste documento continua valendo.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-11-frontend-redesign-design.md docs/superpowers/specs/2026-09-06-frontend-agendamentos-design.md
git commit -m "Documenta a tela nova: faixa de status, formatação e emojis"
```

---

### Task 11: Verificação no navegador contra o mock

Nada aqui envia mensagem real: o mock responde no lugar do WAHA, e o arquivo de agendamentos e o log ficam numa pasta temporária.

- [ ] **Step 1: Montar o ambiente de verificação**

Numa pasta temporária (`$SCRATCH`), crie `data/schedules.json` com três agendamentos (um ativo para daqui a poucos minutos, um pausado, um com cron personalizado), duas mensagens com formatação e emoji, e grupos do mock (`111111111111111111@g.us`, `222222222222222222@g.us`, `999999999999999999@g.us` que falha). Suba o mock (`node harness/mock-waha.js`) e a tela com `WAHA_URL=http://localhost:3999`, `SCHEDULES_PATH=$SCRATCH/data/schedules.json`, `LOG_PATH=$SCRATCH/logs/sends.jsonl`, `UI_PORT=3021`.

- [ ] **Step 2: Conferir, com o agendador parado**

- Faixa vermelha "Agendador parado", WAHA conectado, sem "Próximo envio".
- Lista: interruptor, quando dispara, próximo envio, contagem de grupos, "Enviar agora" em vermelho, menu "⋯".
- Console do navegador sem erros.

- [ ] **Step 3: Subir o agendador contra o mock e conferir**

Rode `node src/index.js` com as mesmas variáveis. Em até 15 s a faixa vira "Agendador rodando" e mostra o próximo envio. Pare com Ctrl+C: a faixa volta a "Agendador parado".

- [ ] **Step 4: Fluxos**

- Novo agendamento com "Escrever nova": formatação pela barra, ⌘B, emoji, prévia, dias úteis, horário, busca de grupo, salvar.
- Editar e fechar com alteração: "Descartar alterações?".
- Pausar e ativar pelo interruptor.
- Enviar agora (grupos do mock, incluindo o que falha): modal, "Enviando…", resultado com a falha listada; histórico com o disparo aberto e o selo "manual".
- Excluir mensagem em uso: aviso 409.
- Aba Mensagens: prévia em duas linhas e "Usada por".

- [ ] **Step 5: Aparência**

Prints no tema claro, no escuro e em 375 px de largura.

- [ ] **Step 6: Encerrar e regressão final**

Pare o mock, a tela e o agendador de verificação. Rode:

```bash
npm test && node harness/run.js all
```

Expected: todos os testes e os checks do harness passando.

