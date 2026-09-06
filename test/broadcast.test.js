// Usa um client injetado — nenhuma chamada de rede é feita aqui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { broadcast, normalizeGroups } from '../src/broadcast.js';

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-unit-'));
  return {
    wahaUrl: 'http://localhost:0',
    session: 'default',
    apiKey: '',
    delayMinMs: 0,
    delayMaxMs: 0,
    logPath: join(dir, 'sends.jsonl'),
  };
}

function fakeClient(failFor = []) {
  const calls = [];
  return {
    calls,
    async sendText(chatId, text) {
      calls.push({ chatId, text });
      if (failFor.includes(chatId)) {
        throw new Error(`Erro 500 ao enviar para ${chatId}: falha simulada`);
      }
      return { id: `msg_${calls.length}` };
    },
  };
}

function readLog(cfg) {
  if (!existsSync(cfg.logPath)) return [];
  return readFileSync(cfg.logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('normalizeGroups remove espaços, vazios e duplicatas preservando a ordem', () => {
  assert.deepEqual(normalizeGroups([' b@g.us ', 'a@g.us', '', 'b@g.us', null]), [
    'b@g.us',
    'a@g.us',
  ]);
  assert.deepEqual(normalizeGroups(undefined), []);
});

test('envia para todos os grupos e contabiliza os sucessos', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const result = await broadcast('olá', ['1@g.us', '2@g.us'], { client, cfg });

  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    client.calls.map((c) => c.chatId),
    ['1@g.us', '2@g.us']
  );
  assert.ok(client.calls.every((c) => c.text === 'olá'));
});

test('segue para os demais grupos quando um envio falha', async () => {
  const cfg = makeCfg();
  const client = fakeClient(['2@g.us']);
  const result = await broadcast('olá', ['1@g.us', '2@g.us', '3@g.us'], { client, cfg });

  assert.equal(client.calls.length, 3, 'todos os grupos devem ser tentados');
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 1);

  const failure = result.results.find((r) => r.status === 'error');
  assert.equal(failure.chatId, '2@g.us');
  assert.match(failure.error, /Erro 500 ao enviar para 2@g\.us/);
});

test('grava uma linha de log por tentativa, com status e erro', async () => {
  const cfg = makeCfg();
  const client = fakeClient(['2@g.us']);
  await broadcast('olá', ['1@g.us', '2@g.us'], { client, cfg, label: 'teste' });

  const entries = readLog(cfg);
  assert.equal(entries.length, 2);
  assert.equal(entries.filter((e) => e.status === 'sent').length, 1);

  const errorEntry = entries.find((e) => e.status === 'error');
  assert.equal(errorEntry.chatId, '2@g.us');
  assert.equal(errorEntry.label, 'teste');
  assert.match(errorEntry.error, /falha simulada/);
  assert.ok(errorEntry.ts, 'toda entrada deve ter timestamp');
});

test('mensagem vazia e lista de grupos vazia são recusadas', async () => {
  const cfg = makeCfg();
  const client = fakeClient();

  await assert.rejects(() => broadcast('   ', ['1@g.us'], { client, cfg }), /Mensagem vazia/);
  await assert.rejects(() => broadcast('olá', [], { client, cfg }), /Nenhum grupo de destino/);
  assert.equal(client.calls.length, 0);
});

test('duplicatas na lista não geram envios repetidos', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const result = await broadcast('olá', ['1@g.us', '1@g.us'], { client, cfg });

  assert.equal(client.calls.length, 1);
  assert.equal(result.sent, 1);
});
