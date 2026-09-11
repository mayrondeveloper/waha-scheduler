// Usa um client injetado — nenhuma chamada de rede é feita aqui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { broadcast, normalizeGroups } from '../src/broadcast.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

// failFor derruba qualquer envio ao grupo; failTextFor derruba só o de texto,
// para simular o anexo que foi e o texto que não foi.
function fakeClient(failFor = [], failTextFor = []) {
  const calls = [];
  return {
    calls,
    async sendText(chatId, text) {
      calls.push({ chatId, text });
      if (failFor.includes(chatId) || failTextFor.includes(chatId)) {
        throw new Error(`Erro 500 ao enviar para ${chatId}: falha simulada`);
      }
      return { id: `msg_${calls.length}` };
    },
    async sendMedia(chatId, file, options) {
      calls.push({ chatId, media: file.filename, kind: options.kind, caption: options.caption ?? null, data: file.data });
      if (failFor.includes(chatId)) {
        throw new Error(`Erro 500 ao enviar anexo para ${chatId}: falha simulada`);
      }
      return { id: `msg_${calls.length}` };
    },
  };
}

// Anexo de verdade em disco, como o broadcast recebe do agendador e do
// "Enviar agora": metadados mais o caminho do arquivo.
function tempMedia({ kind = 'image', mimetype = 'image/png', missing = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-media-'));
  const path = join(dir, 'med-x.png');
  if (!missing) writeFileSync(path, Buffer.from(PNG, 'base64'));
  return { id: 'med-x', filename: 'pixel.png', mimetype, size: 68, kind, path };
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

// ---------- Anexo ----------

test('com anexo e texto curto, o texto vai como legenda, num envio só por grupo', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const result = await broadcast('legenda', ['1@g.us', '2@g.us'], { client, cfg, media: tempMedia(), label: 'foto' });

  assert.equal(result.sent, 2);
  assert.equal(client.calls.length, 2, 'um envio por grupo');
  assert.ok(client.calls.every((c) => c.kind === 'image' && c.caption === 'legenda' && c.data === PNG));

  const entries = readLog(cfg);
  assert.deepEqual(entries.map((e) => e.media), [{ kind: 'image', filename: 'pixel.png' }, { kind: 'image', filename: 'pixel.png' }]);
  assert.equal(entries[0].message, 'legenda');
});

test('texto acima de 1024 caracteres vai separado, depois do anexo', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const long = 'x'.repeat(1025);
  await broadcast(long, ['1@g.us'], { client, cfg, media: tempMedia() });

  assert.deepEqual(client.calls.map((c) => c.media ?? 'texto'), ['pixel.png', 'texto']);
  assert.equal(client.calls[0].caption, null, 'anexo sem legenda');
  assert.equal(client.calls[1].text, long);
});

test('áudio nunca leva legenda: anexo e depois o texto', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  await broadcast('oi', ['1@g.us'], { client, cfg, media: tempMedia({ kind: 'audio', mimetype: 'audio/mpeg' }) });

  assert.deepEqual(client.calls.map((c) => c.media ?? 'texto'), ['pixel.png', 'texto']);
  assert.equal(client.calls[0].caption, null);
});

test('anexo ausente no disco interrompe antes de qualquer envio', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  await assert.rejects(
    () => broadcast('oi', ['1@g.us'], { client, cfg, media: tempMedia({ missing: true }) }),
    /Anexo não encontrado: pixel\.png/
  );
  assert.equal(client.calls.length, 0);
  assert.deepEqual(readLog(cfg), []);
});

test('texto que falha depois do anexo enviado vira erro que diz isso', async () => {
  const cfg = makeCfg();
  const client = fakeClient([], ['1@g.us']);
  const result = await broadcast('oi', ['1@g.us'], { client, cfg, media: tempMedia({ kind: 'audio', mimetype: 'audio/mpeg' }) });

  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /anexo enviado/i);
  assert.match(readLog(cfg)[0].error, /anexo enviado/i);
});
