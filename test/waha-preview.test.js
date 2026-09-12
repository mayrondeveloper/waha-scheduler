// sendTextWithPreview com fetch de mentira: o endpoint e o corpo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTextWithPreview } from '../src/waha/client.js';

const cfg = { wahaUrl: 'http://localhost:3997', session: 'default', apiKey: 'k' };

function withFakeFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}

test('manda para link-custom-preview com a prévia e a imagem quando há', async (t) => {
  const seen = [];
  withFakeFetch(t, async (url, init) => { seen.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { ok: true, status: 201, json: async () => ({ id: 'x' }) }; });
  await sendTextWithPreview('1@g.us', 'Veja https://go.x/r/abc', { url: 'https://go.x/r/abc', title: 'Livro', description: 'Oferta', image: 'https://loja/capa.jpg' }, cfg);
  await sendTextWithPreview('1@g.us', 'Veja https://go.x/r/abc', { url: 'https://go.x/r/abc', title: 'Livro', image: null }, cfg);

  assert.equal(seen[0].url, 'http://localhost:3997/api/send/link-custom-preview');
  assert.equal(seen[0].headers['X-Api-Key'], 'k');
  assert.deepEqual(seen[0].body, {
    session: 'default', chatId: '1@g.us', text: 'Veja https://go.x/r/abc',
    preview: { url: 'https://go.x/r/abc', title: 'Livro', description: 'Oferta', image: { url: 'https://loja/capa.jpg' } },
  });
  assert.deepEqual(seen[1].body.preview, { url: 'https://go.x/r/abc', title: 'Livro', description: '' });
});

test('erro de status e de conexão têm contexto', async (t) => {
  withFakeFetch(t, async () => ({ ok: false, status: 404, text: async () => '{"error":"Cannot POST"}' }));
  await assert.rejects(() => sendTextWithPreview('1@g.us', 'x', { url: 'u', title: 't' }, cfg), /Erro 404 ao enviar com prévia para 1@g\.us/);
  withFakeFetch(t, async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => sendTextWithPreview('1@g.us', 'x', { url: 'u', title: 't' }, cfg), /Falha de conexão ao enviar com prévia/);
});
