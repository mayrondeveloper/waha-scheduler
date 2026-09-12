import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDispatch, clicksEnabled, clearNamesCache } from '../src/dispatch.js';
import { clearPreviewCache } from '../src/preview.js';

const OG = '<html><head><title>Livro</title><meta property="og:title" content="Torto Arado"><meta property="og:image" content="https://loja.exemplo/capa.jpg"></head></html>';
const on = { clicksUrl: 'https://go.exemplo', clicksApiKey: 'k', wahaUrl: 'http://waha', session: 'default', apiKey: '' };
const off = { ...on, clicksUrl: '', clicksApiKey: '' };
const schedule = { id: 'sch-a', name: 'Ofertas da manhã' };
const targets = ['1@g.us', '2@g.us'];

// fetch de mentira: o redirecionador e a página do destino no mesmo lugar.
function fakeFetch({ redirectOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('https://go.exemplo/api/links')) {
      if (!redirectOk) throw new Error('ECONNREFUSED');
      const input = JSON.parse(init.body);
      const links = {};
      for (const g of input.groups) links[g.id] = Object.fromEntries(input.urls.map((u, i) => [u, `https://go.exemplo/r/${g.id.slice(0, 1)}${i}`]));
      return { ok: true, status: 201, json: async () => ({ links }) };
    }
    return { ok: true, status: 200, url, headers: { get: () => 'text/html' }, text: async () => OG, body: null };
  };
  return { calls, fetchImpl };
}

test('clicksEnabled exige URL e chave', () => {
  assert.equal(clicksEnabled(on), true);
  assert.equal(clicksEnabled(off), false);
  assert.equal(clicksEnabled({ clicksUrl: 'x' }), false);
});

test('sem link no texto: tracking "none", sem links nem prévia, e o log ganha o dispatchId', async () => {
  const { calls, fetchImpl } = fakeFetch();
  const p = await prepareDispatch({ schedule, message: 'Bom dia, grupo!', targets, cfg: on, fetchImpl });
  assert.match(p.dispatchId, /^dsp-[0-9a-f]{8}$/);
  assert.equal(p.tracking, 'none');
  assert.equal(p.links, null);
  assert.equal(p.preview, null);
  assert.deepEqual(p.extra, { dispatchId: p.dispatchId, tracking: 'none', links: 0 });
  assert.equal(calls.length, 0);
});

test('cliques ligados: pede os links com os nomes dos grupos e busca a prévia do primeiro link', async () => {
  clearPreviewCache();
  clearNamesCache();
  const { calls, fetchImpl } = fakeFetch();
  const client = { async listGroups() { return [{ id: '1@g.us', name: 'Grupo Alpha' }]; } };
  const p = await prepareDispatch({ schedule: { ...schedule, utm: false }, message: 'Veja https://loja.exemplo/p e https://outra.exemplo/', targets, cfg: on, client, fetchImpl });

  assert.equal(p.tracking, 'ok');
  assert.deepEqual(p.urls, ['https://loja.exemplo/p', 'https://outra.exemplo/']);
  assert.equal(p.links['1@g.us']['https://loja.exemplo/p'], 'https://go.exemplo/r/10');
  assert.equal(p.links['2@g.us']['https://outra.exemplo/'], 'https://go.exemplo/r/21');
  const request = calls.find((c) => c.url.endsWith('/api/links')).body;
  assert.equal(request.dispatchId, p.dispatchId);
  assert.deepEqual(request.groups, [{ id: '1@g.us', name: 'Grupo Alpha' }, { id: '2@g.us', name: '2@g.us' }]);
  assert.equal(request.utm, false, 'utm false do agendamento vai junto');
  assert.deepEqual(p.preview, { url: 'https://loja.exemplo/p', title: 'Torto Arado', description: '', image: 'https://loja.exemplo/capa.jpg' });
  assert.deepEqual(p.extra, { dispatchId: p.dispatchId, tracking: 'ok', links: 2 });
});

test('cliques desligados: "off" e a prévia ainda é buscada; redirecionador fora: "unavailable"', async () => {
  clearPreviewCache();
  clearNamesCache();
  const offCase = await prepareDispatch({ schedule, message: 'https://loja.exemplo/p', targets, cfg: off, fetchImpl: fakeFetch().fetchImpl });
  assert.equal(offCase.tracking, 'off');
  assert.equal(offCase.links, null);
  assert.equal(offCase.preview.title, 'Torto Arado');

  clearPreviewCache();
  const down = await prepareDispatch({ schedule, message: 'https://loja.exemplo/p', targets, cfg: on, fetchImpl: fakeFetch({ redirectOk: false }).fetchImpl });
  assert.equal(down.tracking, 'unavailable');
  assert.equal(down.links, null);
  assert.equal(down.preview.title, 'Torto Arado', 'sem redirecionador a prévia continua');
});
