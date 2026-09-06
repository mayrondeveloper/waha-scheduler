// Usa o mock do harness (nunca a API real). Porta própria para não colidir
// com o harness rodando em paralelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockWaha, FAIL_GROUP_ID } from '../harness/mock-waha.js';
import { extractGroupId, normalizeGroup, listGroups, sendText } from '../src/waha/client.js';

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
