// Usa o mock do harness (nunca a API real). Porta própria para não colidir
// com o harness rodando em paralelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockWaha, FAIL_GROUP_ID } from '../harness/mock-waha.js';
import { extractGroupId, normalizeGroup, listGroups, sendText, sendMedia } from '../src/waha/client.js';

const PORT = 3997;
const cfg = {
  wahaUrl: `http://localhost:${PORT}`,
  session: 'default',
  apiKey: '',
};

test('extractGroupId aceita string, objeto _serialized e valores inválidos', () => {
  assert.equal(extractGroupId('123@g.us'), '123@g.us');
  assert.equal(extractGroupId({ _serialized: '456@g.us' }), '456@g.us');
  assert.equal(extractGroupId(null), null);
  assert.equal(extractGroupId({ outro: 'campo' }), null);
});

test('normalizeGroup usa name, cai para subject e marca grupo sem nome', () => {
  assert.deepEqual(normalizeGroup({ id: '1@g.us', name: 'Alpha' }), { id: '1@g.us', name: 'Alpha' });
  assert.deepEqual(normalizeGroup({ id: { _serialized: '2@g.us' }, subject: 'Beta' }), {
    id: '2@g.us',
    name: 'Beta',
  });
  assert.deepEqual(normalizeGroup({ id: '3@g.us' }), { id: '3@g.us', name: '(sem nome)' });
  assert.equal(normalizeGroup({ name: 'sem id' }), null);
});

test('listGroups normaliza os grupos devolvidos pelo WAHA', async (t) => {
  const { server } = await startMockWaha(PORT);
  t.after(() => server.close());

  const groups = await listGroups(cfg);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.id),
    ['111111111111111111@g.us', '222222222222222222@g.us', FAIL_GROUP_ID]
  );
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Grupo Alpha', 'Grupo Beta', 'Grupo Que Falha']
  );
});

test('sendText entrega a mensagem e lança erro com contexto quando o WAHA falha', async (t) => {
  const { server, calls } = await startMockWaha(PORT);
  t.after(() => server.close());

  const result = await sendText('111111111111111111@g.us', 'olá', cfg);
  assert.ok(result.id, 'esperava um id de mensagem na resposta');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].text, 'olá');
  assert.equal(calls[0].session, 'default');

  await assert.rejects(
    () => sendText(FAIL_GROUP_ID, 'olá', cfg),
    (err) => {
      assert.match(err.message, /Erro 500 ao enviar para 999999999999999999@g\.us/);
      return true;
    }
  );
});

test('erro de conexão vira mensagem com contexto', async () => {
  const offline = { wahaUrl: 'http://localhost:3996', session: 'default', apiKey: '' };
  await assert.rejects(() => listGroups(offline), /Falha de conexão ao listar grupos/);
});

// O mock do harness não tem os endpoints de mídia (e não pode ser alterado):
// aqui o fetch é falso, e o que se prova é o endpoint e o corpo por tipo.
const FILE = { mimetype: 'image/png', filename: 'a.png', data: 'AAAA' };

function withFakeFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = original; });
}

test('sendMedia escolhe o endpoint pelo tipo e envia o arquivo em base64, com legenda quando há', async (t) => {
  const seen = [];
  withFakeFetch(t, async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 201, json: async () => ({ id: 'x' }) };
  });
  const withKey = { ...cfg, apiKey: 'segredo' };

  await sendMedia('1@g.us', FILE, { kind: 'image', caption: 'legenda' }, withKey);
  await sendMedia('1@g.us', { ...FILE, mimetype: 'video/mp4' }, { kind: 'video' }, withKey);
  await sendMedia('1@g.us', { ...FILE, mimetype: 'application/pdf' }, { kind: 'document', caption: '' }, withKey);
  await sendMedia('1@g.us', { ...FILE, mimetype: 'audio/mpeg' }, { kind: 'audio' }, withKey);

  assert.deepEqual(seen.map((s) => s.url), [
    `${cfg.wahaUrl}/api/sendImage`,
    `${cfg.wahaUrl}/api/sendVideo`,
    `${cfg.wahaUrl}/api/sendFile`,
    `${cfg.wahaUrl}/api/sendFile`,
  ]);
  assert.deepEqual(seen[0].body, { session: 'default', chatId: '1@g.us', file: FILE, caption: 'legenda' });
  assert.equal('caption' in seen[1].body, false, 'sem legenda, o campo não vai');
  assert.equal('caption' in seen[2].body, false, 'legenda vazia também não vai');
  assert.equal(seen[0].headers['X-Api-Key'], 'segredo');
});

test('sendMedia lança erro com contexto no status e na conexão', async (t) => {
  withFakeFetch(t, async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  await assert.rejects(() => sendMedia('1@g.us', FILE, { kind: 'image' }, cfg), /Erro 500 ao enviar anexo para 1@g\.us: boom/);

  withFakeFetch(t, async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => sendMedia('1@g.us', FILE, { kind: 'image' }, cfg), /Falha de conexão ao enviar anexo para 1@g\.us/);
});
