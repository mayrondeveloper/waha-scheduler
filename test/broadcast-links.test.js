// Links rastreáveis por grupo e prévia customizada no envio, com degradação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { broadcast } from '../src/broadcast.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-links-'));
  return { wahaUrl: 'http://localhost:0', session: 'default', apiKey: '', delayMinMs: 0, delayMaxMs: 0, logPath: join(dir, 'sends.jsonl'), dir };
}

function fakeClient({ previewFails = false, withPreview = true } = {}) {
  const calls = [];
  const client = {
    calls,
    async sendText(chatId, text) { calls.push({ kind: 'text', chatId, text }); return {}; },
    async sendMedia(chatId, file, options) { calls.push({ kind: 'media', chatId, caption: options.caption ?? null }); return {}; },
  };
  if (withPreview) {
    client.sendTextWithPreview = async (chatId, text, preview) => {
      calls.push({ kind: 'preview', chatId, text, preview });
      if (previewFails) throw new Error('Erro 404 ao enviar com prévia');
      return {};
    };
  }
  return client;
}

const readLog = (cfg) => readFileSync(cfg.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const MESSAGE = '*Oferta* https://loja.exemplo/p?tag=x';
const LINKS = { '1@g.us': { 'https://loja.exemplo/p?tag=x': 'https://go.x/r/A1' }, '2@g.us': { 'https://loja.exemplo/p?tag=x': 'https://go.x/r/B2' } };
const PREVIEW = { url: 'https://loja.exemplo/p?tag=x', title: 'Torto Arado', description: 'Oferta', image: 'https://loja.exemplo/capa.jpg' };
const EXTRA = { dispatchId: 'dsp-1', tracking: 'ok', links: 1 };

test('cada grupo recebe o próprio link curto, com a prévia apontando para ele; o log tem dispatchId e tracking', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  await broadcast(MESSAGE, ['1@g.us', '2@g.us'], { client, cfg, links: LINKS, preview: PREVIEW, extra: EXTRA });

  assert.deepEqual(client.calls.map((c) => [c.kind, c.text, c.preview.url]), [
    ['preview', '*Oferta* https://go.x/r/A1', 'https://go.x/r/A1'],
    ['preview', '*Oferta* https://go.x/r/B2', 'https://go.x/r/B2'],
  ]);
  assert.equal(client.calls[0].preview.title, 'Torto Arado');
  const log = readLog(cfg);
  assert.deepEqual(log.map((e) => [e.dispatchId, e.tracking, e.links, e.preview, e.message]), [
    ['dsp-1', 'ok', 1, 'sent', '*Oferta* https://go.x/r/A1'],
    ['dsp-1', 'ok', 1, 'sent', '*Oferta* https://go.x/r/B2'],
  ]);
});

test('sem links (redirecionador fora) o texto sai original, ainda com prévia; a prévia falhando cai para texto simples', async () => {
  const cfg = makeCfg();
  const client = fakeClient({ previewFails: true });
  const result = await broadcast(MESSAGE, ['1@g.us'], { client, cfg, links: null, preview: PREVIEW, extra: { ...EXTRA, tracking: 'unavailable' } });

  assert.equal(result.sent, 1);
  assert.deepEqual(client.calls.map((c) => c.kind), ['preview', 'text']);
  assert.equal(client.calls[1].text, MESSAGE);
  assert.equal(client.calls[0].preview.url, 'https://loja.exemplo/p?tag=x', 'sem link curto a prévia aponta para o original');
  assert.equal(readLog(cfg)[0].preview, 'failed');
  assert.equal(readLog(cfg)[0].tracking, 'unavailable');
});

test('client sem prévia customizada manda texto simples; com anexo a prévia não é usada', async () => {
  const cfg = makeCfg();
  const plain = fakeClient({ withPreview: false });
  await broadcast(MESSAGE, ['1@g.us'], { client: plain, cfg, links: LINKS, preview: PREVIEW });
  assert.deepEqual(plain.calls.map((c) => [c.kind, c.text]), [['text', '*Oferta* https://go.x/r/A1']]);
  assert.equal(readLog(cfg)[0].preview, 'failed');

  const cfg2 = makeCfg();
  const path = join(cfg2.dir, 'med.png');
  writeFileSync(path, Buffer.from(PNG, 'base64'));
  const media = { id: 'med', filename: 'a.png', mimetype: 'image/png', size: 70, kind: 'image', path };
  const client = fakeClient();
  await broadcast(MESSAGE, ['1@g.us'], { client, cfg: cfg2, links: LINKS, preview: PREVIEW, media });
  assert.deepEqual(client.calls.map((c) => [c.kind, c.caption]), [['media', '*Oferta* https://go.x/r/A1']]);
  assert.equal('preview' in readLog(cfg2)[0], false);
});
