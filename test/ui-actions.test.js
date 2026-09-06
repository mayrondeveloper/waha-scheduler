import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockWaha } from '../harness/mock-waha.js';
import { startUi } from '../src/ui/server.js';

const PORT = 3995;

// Servidor exige Content-Type: application/json em toda rota mutante,
// incluindo POST /run, que não tem corpo — o cabeçalho continua obrigatório.
const run = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' } });

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
    uiPort: 0,
    wahaUrl: `http://localhost:${PORT}`, session: 'default', apiKey: '',
    delayMinMs: 0, delayMaxMs: 0, logPath: join(dir, 'sends.jsonl'),
  };
  const { server, port } = await startUi({ schedulesPath: newStore(dir), cfg });
  t.after(() => server.close());

  return { call: (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init), calls, cfg, dir };
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
  const cfg = { uiPort: 0, wahaUrl: 'http://localhost:3994',
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

  const res = await call('/api/schedules/sch-a/run', run());
  assert.equal(res.status, 200);

  const resumo = await res.json();
  assert.equal(resumo.sent, 1);
  assert.equal(resumo.failed, 0);
  assert.equal(calls.length, 1, 'exatamente um envio pelo mock');
  assert.equal(calls[0].text, 'Olá do teste!');
});

test('disparar agendamento inexistente responde 404 sem enviar nada', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-fantasma/run', run());
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test('histórico devolve as linhas do log, mais recentes primeiro', async (t) => {
  const { call } = await boot(t);
  await call('/api/schedules/sch-a/run', run());

  const logs = await (await call('/api/logs?limit=10')).json();
  assert.ok(logs.length >= 1);
  assert.equal(logs[0].status, 'sent');
  assert.equal(logs[0].chatId, '111111111111111111@g.us');
});

test('histórico inexistente devolve lista vazia, não erro', async (t) => {
  const { call } = await boot(t);
  const res = await call('/api/logs');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('linha corrompida no meio do log não derruba a leitura', async (t) => {
  const { call, cfg } = await boot(t);

  // Duas linhas válidas ao redor de uma corrompida — a leitura tem que
  // ignorar só a linha ruim, sem quebrar nem devolver erro.
  appendFileSync(cfg.logPath, `${JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', status: 'sent', chatId: 'a@g.us', message: 'primeira' })}\n`);
  appendFileSync(cfg.logPath, '{ isso não é json válido\n');
  appendFileSync(cfg.logPath, `${JSON.stringify({ ts: '2026-01-01T00:00:01.000Z', status: 'sent', chatId: 'b@g.us', message: 'terceira' })}\n`);

  const res = await call('/api/logs?limit=10');
  assert.equal(res.status, 200);

  const logs = await res.json();
  assert.equal(logs.length, 2, 'a linha corrompida deve ser descartada, não derrubar a leitura');
  assert.equal(logs[0].chatId, 'b@g.us', 'mais recente primeiro');
  assert.equal(logs[1].chatId, 'a@g.us');
});
