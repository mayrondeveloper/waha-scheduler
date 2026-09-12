import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenGraph, fetchOpenGraph, clearPreviewCache } from '../src/preview.js';

const HTML = `<!doctype html><html><head>
<title>Título da página</title>
<meta property="og:title" content="Torto Arado &amp; outros" />
<meta name="description" content="descrição comum">
<meta property='og:description' content='Livro em oferta' />
<meta property="og:image" content="/capa.jpg">
</head><body>x</body></html>`;

test('parseOpenGraph lê título, descrição e imagem (resolvida contra a URL)', () => {
  assert.deepEqual(parseOpenGraph(HTML, 'https://loja.exemplo/p/1'), {
    title: 'Torto Arado & outros', description: 'Livro em oferta', image: 'https://loja.exemplo/capa.jpg',
  });
  assert.deepEqual(parseOpenGraph('<title>Só título</title><meta name="description" content="d">', 'https://x.y/'), { title: 'Só título', description: 'd', image: null });
  assert.equal(parseOpenGraph('<html><body>nada</body></html>', 'https://x.y/'), null);
});

function fakeResponse({ ok = true, type = 'text/html; charset=utf-8', body = HTML, url = '' } = {}) {
  return { ok, status: ok ? 200 : 500, url, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, text: async () => body, body: null };
}

test('fetchOpenGraph devolve a prévia com a URL pedida e usa o cache por 1 h', async () => {
  clearPreviewCache();
  let calls = 0;
  let now = 0;
  const fetchImpl = async () => { calls++; return fakeResponse(); };
  const first = await fetchOpenGraph('https://loja.exemplo/p/1', { fetchImpl, now: () => now });
  assert.equal(first.url, 'https://loja.exemplo/p/1');
  assert.equal(first.title, 'Torto Arado & outros');
  await fetchOpenGraph('https://loja.exemplo/p/1', { fetchImpl, now: () => now });
  assert.equal(calls, 1, 'segunda chamada vem do cache');
  now = 3_600_001;
  await fetchOpenGraph('https://loja.exemplo/p/1', { fetchImpl, now: () => now });
  assert.equal(calls, 2, 'cache expira em 1 h');
});

test('sem HTML, sem título, erro ou tempo esgotado: nulo, e o nulo também é cacheado', async () => {
  clearPreviewCache();
  assert.equal(await fetchOpenGraph('https://a.exemplo/', { fetchImpl: async () => fakeResponse({ type: 'application/pdf' }) }), null);
  assert.equal(await fetchOpenGraph('https://b.exemplo/', { fetchImpl: async () => fakeResponse({ body: '<p>sem título</p>' }) }), null);
  assert.equal(await fetchOpenGraph('https://c.exemplo/', { fetchImpl: async () => { throw new Error('rede'); } }), null);
  let calls = 0;
  const boom = async () => { calls++; throw new Error('rede'); };
  await fetchOpenGraph('https://d.exemplo/', { fetchImpl: boom });
  await fetchOpenGraph('https://d.exemplo/', { fetchImpl: boom });
  assert.equal(calls, 1);
});

test('HTML maior que o limite é cortado e ainda rende a prévia quando o head cabe', async () => {
  clearPreviewCache();
  const big = HTML + 'x'.repeat(2_000_000);
  const preview = await fetchOpenGraph('https://e.exemplo/', { fetchImpl: async () => fakeResponse({ body: big }), maxBytes: 5000 });
  assert.equal(preview.title, 'Torto Arado & outros');
});
