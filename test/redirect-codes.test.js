import test from 'node:test';
import assert from 'node:assert/strict';
import { newCode, slug, withUtm, classifyAccess, visitorHash, ipHash, PREVIEW_WINDOW_MS } from '../src/redirect/codes.js';

test('newCode tem 10 caracteres base62 e não repete', () => {
  const codes = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = newCode();
    assert.match(code, /^[0-9A-Za-z]{10}$/);
    codes.add(code);
  }
  assert.equal(codes.size, 1000);
  assert.equal(newCode(32).length, 32);
});

test('slug: minúsculas, sem acento, hífens, e "sem-nome" quando não sobra nada', () => {
  assert.equal(slug('Ofertas da Manhã!'), 'ofertas-da-manha');
  assert.equal(slug('  Compara Livros - Ofertas  '), 'compara-livros-ofertas');
  assert.equal(slug('123@g.us'), '123-g-us');
  assert.equal(slug('!!!'), 'sem-nome');
  assert.equal(slug(null), 'sem-nome');
});

test('withUtm acrescenta os quatro parâmetros e não sobrescreve os que já existem', () => {
  const url = withUtm('https://loja.exemplo/produto?tag=afiliado&utm_source=meu', { campaign: 'Ofertas da manhã', content: 'Grupo Alpha' });
  const params = new URL(url).searchParams;
  assert.equal(params.get('tag'), 'afiliado', 'a query original fica');
  assert.equal(params.get('utm_source'), 'meu', 'o utm_source existente não é sobrescrito');
  assert.equal(params.get('utm_medium'), 'grupo');
  assert.equal(params.get('utm_campaign'), 'ofertas-da-manha');
  assert.equal(params.get('utm_content'), 'grupo-alpha');
  assert.throws(() => withUtm('não é url', { campaign: 'x', content: 'y' }));
});

test('classifyAccess: robôs e prévias por User-Agent e método; humano no resto', () => {
  const base = { method: 'GET', ipHash: 'v1', link: null, nowMs: Date.now() };
  const human = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  assert.equal(classifyAccess({ ...base, userAgent: human }), 'human');
  assert.equal(classifyAccess({ ...base, userAgent: 'WhatsApp/2.23.20.0' }), 'bot');
  assert.equal(classifyAccess({ ...base, userAgent: 'facebookexternalhit/1.1' }), 'bot');
  assert.equal(classifyAccess({ ...base, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), 'bot');
  assert.equal(classifyAccess({ ...base, userAgent: 'curl/8.7.1' }), 'bot');
  assert.equal(classifyAccess({ ...base, userAgent: '' }), 'bot');
  assert.equal(classifyAccess({ ...base, userAgent: human, method: 'HEAD' }), 'bot');
});

test('classifyAccess: o criador do link nos primeiros 60 s é prévia; depois, humano', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  const human = 'Mozilla/5.0 Chrome/120';
  const link = { creator_ip_hash: 'criador', created_at: new Date(now - 10_000).toISOString() };
  assert.equal(classifyAccess({ method: 'GET', userAgent: human, ipHash: 'criador', link, nowMs: now }), 'preview');
  assert.equal(classifyAccess({ method: 'GET', userAgent: human, ipHash: 'outro', link, nowMs: now }), 'human');
  const old = { ...link, created_at: new Date(now - PREVIEW_WINDOW_MS - 1000).toISOString() };
  assert.equal(classifyAccess({ method: 'GET', userAgent: human, ipHash: 'criador', link: old, nowMs: now }), 'human');
});

test('hashes mudam com o sal e nunca contêm o endereço', () => {
  const a = visitorHash('sal1', '203.0.113.9', 'UA');
  const b = visitorHash('sal2', '203.0.113.9', 'UA');
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(a, /203\.0\.113/);
  assert.equal(ipHash('sal1', '203.0.113.9'), ipHash('sal1', '203.0.113.9'));
  assert.notEqual(ipHash('sal1', '203.0.113.9'), visitorHash('sal1', '203.0.113.9', ''));
});
