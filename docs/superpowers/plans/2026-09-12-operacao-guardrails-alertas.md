# Ajustes, janela de silêncio, limite por hora, spintax, alertas e pausa geral — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proteger o número e avisar o dono: ajustes na tela (pausa geral, janela de silêncio, limite por hora, alertas), variações de texto por spintax e alertas por WhatsApp e URL de push.

**Architecture:** `settings` no arquivo de agendamentos, editado pela aba Ajustes e recarregado pelo agendador via `fs.watch`. O agendador decide por disparo: pausado → registra pulado; janela → grava `pending` e o tique (de A) dispara no fim; senão envia. O envio (`broadcast`) sorteia o spintax por grupo e freia pelo log de envios. Um vigia da sessão do WAHA a cada 60 s alimenta o status e os alertas.

**Tech Stack:** Node 18+ ESM, node-cron, `node:test`, tela em módulos ES, DOM falso.

**Spec:** `docs/superpowers/specs/2026-09-12-operacao-guardrails-alertas-design.md`

## Global Constraints

- Sem dependência nova; nomes em inglês, mensagens em português; sem `console.log`; JSDoc só em exports.
- Alertas nunca lançam nem atrasam envio: erro só no log do agendador.
- Harness intocado e verde; `settings` ausente no arquivo = padrões (arquivos atuais e o v1 do harness continuam válidos).
- Commits por task com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `settings` no arquivo e na API

**Files:**
- Modify: `src/schedules.js` (`DEFAULT_SETTINGS`, `validateSettings`, `normalizeStore` devolve `settings`)
- Create: `src/ui/routes/settings.js` (`GET /api/settings`, `PUT /api/settings`), registrar em `src/ui/server.js`
- Test: `test/settings.test.js`, `test/ui-settings.test.js`

**Interfaces:**
- `DEFAULT_SETTINGS = { paused: false, quietHours: null, hourlyLimit: 50, alerts: { whatsapp: true, pushUrl: '' } }`
- `validateSettings(raw)` → objeto completo; erros `Ajustes: campo "quietHours.start" deve ser HH:MM.` etc.
- `normalizeStore` devolve `{ version, defaultGroups, groupLists, settings, messages, schedules }`; `settings` sempre presente (padrões preenchidos), gravado no arquivo a partir da primeira escrita.
- Agendamento ganha `pending: { at: ISO, reason: 'quiet', from: ISO } | ausente` (validado: `at`/`from` ISO, `reason` string).

- [ ] Testes: padrões quando ausente; `quietHours` com `HH:MM`; `hourlyLimit` 0..1000 inteiro; `pushUrl` vazia ou http(s); `paused` booleano; `pending` válido/inválido; PUT devolve o objeto gravado e 400 com o campo errado; GET com padrões num arquivo antigo.
- [ ] Implementar; `npm test`; commit `Ajustes no arquivo de agendamentos e na API`.

---

### Task 2: Spintax

**Files:**
- Create: `public/spintax.js` (importado pelo servidor também)
- Modify: `public/messages-view.js` (prévia com a primeira variação e a contagem), `src/ui/server.js` (STATIC_FILES `/spintax.js`)
- Test: `test/ui-spintax.test.js`, `test/ui-views.test.js` (prévia)

**Interfaces:**
- `spin(text, random = Math.random)` → uma combinação; `countVariants(text)` → número (1 sem spintax); `firstVariant(text)` → a primeira escolha de cada grupo. Aninhamento resolvido de dentro para fora; `{` sem `}` ou `}` solto é literal; `{só um}` vira `só um`.
- `bubbleContent({ text, media, mediaSrc })` mostra `firstVariant(text)`; `messageEditor` mostra `<p class="hint" data-role="variants">8 combinações</p>` quando `countVariants > 1` (escondido senão); o `app.js` atualiza o hint ao digitar.

- [ ] Testes: sem chaves; `{a|b}` com random fixo escolhe b; aninhado `{Bom {dia|tarde}|Olá}`; `countVariants('{a|b} {c|d|e}') === 6`; chave sem par literal; prévia e hint.
- [ ] Implementar; commit `Spintax: variações de texto por grupo`.

---

### Task 3: Janela de silêncio, freio por hora e spintax no envio

**Files:**
- Create: `src/quiet.js`, `src/send-log.js`
- Modify: `src/broadcast.js`
- Test: `test/quiet.test.js`, `test/send-log.test.js`, `test/broadcast-guardrails.test.js`

**Interfaces:**
- `inQuietHours(nowMs, quiet, timeZone)` → boolean (`quiet` nulo → false); `quietEnd(nowMs, quiet, timeZone)` → ms do próximo fim da janela (hoje ou amanhã).
- `countRecentSends(logPath, { windowMs = 3_600_000, now = Date.now() })` → número de linhas `sent` na janela; arquivo ausente → 0; linha corrompida ignorada.
- `broadcast(message, groups, { ..., hourlyLimit = 0, random, now, sleep })`: por grupo, `text = spin(message, random)`; se `hourlyLimit > 0`: enquanto `countRecentSends >= hourlyLimit` espera até o `ts` mais antigo da janela + 1 h (`waitedMs` acumulado, gravado na linha); envia; loga `message: text`.
- `sleep` e `now` injetáveis para o teste não esperar de verdade.

- [ ] Testes: janela normal e que vira meia-noite (22:00–08:00 em SP: 23:30 dentro, 12:00 fora, `quietEnd` de 23:30 é 08:00 do dia seguinte); contagem do log; freio espera com limite 2 e três grupos (o terceiro grava `waitedMs > 0`), não espera com limite 0; spintax por grupo (`{a|b}` com random alternado grava textos diferentes).
- [ ] Implementar; commit `Janela de silêncio, freio por hora e spintax no envio`.

---

### Task 4: Agendador: pausa, adiamento, vigia da sessão e alertas

**Files:**
- Create: `src/alerts.js`
- Modify: `src/waha/client.js` (`getSession`), `src/index.js`, `src/scheduler-status.js` (status ganha `waha`)
- Test: `test/alerts.test.js`, `test/waha-client.test.js` (getSession), `test/scheduler-guardrails.test.js`

**Interfaces:**
- `getSession(cfg)` → `GET /api/sessions/{session}` → `{ status, me: { id, pushName } | null }`; erro com contexto como as outras chamadas.
- `sendAlert({ title, text, channels }, { settings, cfg, client, me, fetchImpl = fetch })` → `Promise<void>`, nunca rejeita; `whatsapp` manda `client.sendText(me.id, "*<title>*\n<text>")` quando `settings.alerts.whatsapp` e `me`; `push` faz `POST pushUrl` com corpo `text`, cabeçalhos `Title: <title>` e `Content-Type: text/plain; charset=utf-8`, quando `pushUrl`.
- `startScheduler` ganha `sessionPollMs` (default 60 000), `client` (default waha client), `fetchImpl`. Ao disparar pelo cron: `settings.paused` → uma linha `skipped` por destino com `reason: 'paused'` e `warn`; `inQuietHours` → grava `pending` (só se não houver) e `info`; senão `dispatch`. O tique trata `pending` vencido: dispara com `deferredFrom` e limpa `pending` (gravado antes do envio). Envio único vencido dentro da janela → `pending` para o fim. Tique não avalia envios únicos enquanto pausado.
- Vigia: a cada `sessionPollMs`, `getSession`; grava `waha: { status, me, checkedAt, error }` no status; transição `WORKING → outro` alerta `push` "Número desconectado"; `outro → WORKING` alerta `whatsapp+push` "Número reconectado". Disparo com `failed > 0` alerta "Agendamento X: N de M grupos falharam: <primeiro erro>". Envio único perdido alerta "Envio único perdido".
- O log de envios recebe `appendSendLog({ status: 'skipped', chatId, message, label, reason })`.

- [ ] Testes: alertas por canal e sem lançar; getSession; pausado registra pulado e não envia; janela grava pending e o tique dispara com `deferredFrom` quando `now` passa do fim; pending não empilha; vigia grava `waha` e dispara alertas nas transições (client falso com status mutável).
- [ ] Implementar; `node harness/run.js phase3`; commit `Agendador: pausa geral, adiamento pela janela de silêncio, vigia da sessão e alertas`.

---

### Task 5: API de status, sessão e teste de alerta; freio no envio manual

**Files:**
- Modify: `src/ui/routes/actions.js` (`GET /api/status` com `paused`, `quietHours`, `waha`; `GET /api/session`; `POST /api/alerts/test`; run passa `hourlyLimit`), `src/ui/routes/settings.js`
- Test: `test/ui-settings.test.js`, `test/ui-status.test.js`

- [ ] Testes: status devolve `paused`/`quietHours` do arquivo e `waha` do status; `/api/session` proxy (mock do harness não tem a rota → 502 com contexto; teste com servidor local que responde); `/alerts/test` chama os canais configurados e devolve `{ sent: ['push'] }`.
- [ ] Implementar; commit `API: status com pausa, janela e sessão; teste de alerta`.

---

### Task 6: Tela: aba Ajustes, faixa, avisos, spintax e histórico

**Files:**
- Create: `public/settings-view.js`
- Modify: `public/index.html`, `public/app.js`, `public/status-view.js`, `public/schedules-view.js` (aviso da janela no formulário e no modal), `public/history-view.js` e `public/history.js` (`skipped`, `deferredFrom`, `waitedMs`), `public/style.css`, `src/ui/server.js`
- Test: `test/ui-settings-view.test.js`, `test/ui-history.test.js`, `test/ui-status-view.test.js`

**Interfaces:**
- `settingsForm({ settings, session })` → `<form id="form-settings">` com `paused` (switch `name="paused"`), `quietEnabled`, `quietStart`, `quietEnd`, `hourlyLimit`, `alertWhatsapp`, `pushUrl`, botão `data-action="alert-test"`; `formSettings(form)` → objeto para o PUT.
- `statusBar` recebe `settings` e `quietNow` (calculado pelo servidor em `/api/status`: `quietUntil: ISO | null`): pausado → item `danger` "Envios pausados" + `<button data-action="resume-all">Retomar</button>`; janela → item neutro "Janela de silêncio até 08:00".
- `sendConfirm` recebe `warnings: string[]`.
- Histórico: linha `skipped` com "Pulado: envios pausados"; disparo com `deferredFrom` mostra "adiado pela janela de silêncio (era 23:00)"; linha com `waitedMs` mostra "esperou 4 min pelo limite por hora". `groupDispatches` trata `skipped` como um disparo próprio (0 enviados, N pulados).
- App: aba `settings` ("Ajustes"), `saveSettings`, `resume-all` (PUT com `paused: false`), `alert-test`, hint de variações ao digitar no editor, aviso da janela ao mudar horário no formulário (`inQuietHours` reimplementado em `public/quiet.js`? Não: o servidor devolve `quietHours` e a tela compara só a hora `HH:MM` do formulário com a janela, em `public/settings-view.js` → `timeInQuiet('23:00', quiet)`).

- [ ] Testes por peça; commit `Tela: aba Ajustes, pausa geral, avisos da janela e do freio, spintax e histórico`.

---

### Task 7: README, harness e verificação no navegador

- [ ] README: Ajustes (cada item), spintax, alertas (ntfy.sh), log com `skipped`/`deferredFrom`/`waitedMs`, `settings` no formato.
- [ ] `npm test`; `node harness/run.js all`.
- [ ] Navegador contra o mock: salvar ajustes (pausa ligada) → faixa vermelha com Retomar; envio manual com aviso; retomar; janela de silêncio cobrindo agora → criar envio único para daqui a 1 min com o agendador do worktree rodando → card fica pendente/adiado e o histórico mostra o adiamento (usar janela curta terminando em 2 min para ver o disparo); mensagem com spintax mostra "N combinações" e o histórico grava textos diferentes por grupo; limite por hora 1 → segundo grupo espera (`waitedMs` no log).
- [ ] Commit final.
