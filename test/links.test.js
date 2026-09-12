import test from 'node:test';
import assert from 'node:assert/strict';
import { findUrls, rewriteLinks, requestLinks, fetchClicks } from '../src/links.js';

test('findUrls acha URLs http(s) únicas, na ordem, sem a pontuação colada no fim', () => {
  const text = 'Veja: https://loja.exemplo/p?tag=x. Ou (https://outra.exemplo/a_(b)) e de novo https://loja.exemplo/p?tag=x!\nhttp://sem-tls.exemplo/';
  assert.deepEqual(findUrls(text), ['https://loja.exemplo/p?tag=x', 'https://outra.exemplo/a_(b)', 'http://sem-tls.exemplo/']);
  assert.deepEqual(findUrls('sem link nenhum, nem ftp://x'), []);
  assert.deepEqual(findUrls('*negrito* https://x.y/z, ok'), ['https://x.y/z']);
  assert.deepEqual(findUrls(null), []);
});

test('rewriteLinks troca cada URL pela curta e preserva o resto', () => {
  const text = '*Oferta* https://loja.exemplo/p?tag=x\n> https://loja.exemplo/p?tag=x e https://outra.exemplo/';
  const out = rewriteLinks(text, { 'https://loja.exemplo/p?tag=x': 'https://go.x/r/A1', 'https://outra.exemplo/': 'https://go.x/r/B2' });
  assert.equal(out, '*Oferta* https://go.x/r/A1\n> https://go.x/r/A1 e https://go.x/r/B2');
  assert.equal(rewriteLinks(text, {}), text);
  assert.equal(rewriteLinks(text, null), text);
});

const cfg = { clicksUrl: 'https://go.exemplo', clicksApiKey: 'chave' };
const input = { dispatchId: 'dsp-1', schedule: { id: 's', name: 'x' }, groups: [{ id: '1@g.us', name: 'A' }], urls: ['https://loja.exemplo/'], utm: true };

test('requestLinks manda a chave e devolve o mapa; erros têm contexto', async () => {
  const seen = [];
  const ok = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 201, json: async () => ({ links: { '1@g.us': { 'https://loja.exemplo/': 'https://go.exemplo/r/abc' } } }) }; };
  const links = await requestLinks(input, cfg, { fetchImpl: ok });
  assert.deepEqual(links, { '1@g.us': { 'https://loja.exemplo/': 'https://go.exemplo/r/abc' } });
  assert.equal(seen[0].url, 'https://go.exemplo/api/links');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer chave');
  assert.deepEqual(JSON.parse(seen[0].init.body), input);

  await assert.rejects(() => requestLinks(input, cfg, { fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":"chave"}' }) }), /Erro 401 do redirecionador/);
  await assert.rejects(() => requestLinks(input, cfg, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }), /Resposta inesperada/);
  await assert.rejects(() => requestLinks(input, cfg, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), /Redirecionador indisponível .*ECONNREFUSED/);
});

test('requestLinks desiste no tempo limite', async () => {
  const slow = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  await assert.rejects(() => requestLinks(input, cfg, { fetchImpl: slow, timeoutMs: 30 }), /não respondeu em 30 ms/);
});

test('fetchClicks devolve por disparo, com nulo para o que falhou', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('dsp-ok')) return { ok: true, json: async () => ({ clicks: 3, unique: 2, groups: {} }) };
    return { ok: false, status: 500 };
  };
  const result = await fetchClicks(['dsp-ok', 'dsp-fail'], cfg, { fetchImpl });
  assert.deepEqual(result, { 'dsp-ok': { clicks: 3, unique: 2, groups: {} }, 'dsp-fail': null });
});
