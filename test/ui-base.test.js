import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../public/api.js';
import { escape, icon } from '../public/html.js';

function withFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}

test('api manda Content-Type JSON em todo método que altera dados, mesmo sem corpo', async (t) => {
  const seen = [];
  withFetch(t, async (url, init) => {
    seen.push([url, init?.headers?.['Content-Type']]);
    return { ok: true, status: 200, json: async () => ({}) };
  });
  await api('/schedules/sch-a', { method: 'DELETE' });
  await api('/schedules/sch-a/run', { method: 'POST' });
  await api('/schedules');
  assert.deepEqual(seen, [
    ['/api/schedules/sch-a', 'application/json'],
    ['/api/schedules/sch-a/run', 'application/json'],
    ['/api/schedules', undefined],
  ]);
});

test('api lança o erro em português que o servidor mandou', async (t) => {
  withFetch(t, async () => ({ ok: false, status: 409, json: async () => ({ error: 'Mensagem em uso por: bom-dia.' }) }));
  await assert.rejects(api('/messages/msg-a', { method: 'DELETE' }), /Mensagem em uso por: bom-dia\./);
});

test('api sem corpo de erro diz o status e o caminho', async (t) => {
  withFetch(t, async () => ({ ok: false, status: 502, json: async () => { throw new Error('não é JSON'); } }));
  await assert.rejects(api('/groups'), /Erro 502 em \/groups/);
});

test('escape neutraliza aspas e sinais de HTML', () => {
  assert.equal(escape(`"><img src=x onerror='1'>&`), '&quot;&gt;&lt;img src=x onerror=&#39;1&#39;&gt;&amp;');
});

test('ícone é SVG decorativo; nome desconhecido é erro', () => {
  assert.match(icon('plus'), /^<svg class="icon"[^>]*aria-hidden="true"/);
  assert.throws(() => icon('nao-existe'), /Ícone desconhecido: "nao-existe"/);
});
