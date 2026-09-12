import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-lists-ui-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    groupLists: [{ id: 'lst-a', name: 'Ofertas SP', groups: ['1@g.us', '2@g.us'] }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0, timezone: 'America/Sao_Paulo' } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = () => ({ method: 'DELETE', headers: { 'Content-Type': 'application/json' } });

test('lista, cria, edita e exclui lista de grupos', async (t) => {
  const call = await boot(t, newStore());

  const lists = await (await call('/api/lists')).json();
  assert.deepEqual(lists, [{ id: 'lst-a', name: 'Ofertas SP', groups: ['1@g.us', '2@g.us'] }]);

  const res = await call('/api/lists', json('POST', { name: 'Comunidade', groups: ['3@g.us', '3@g.us'] }));
  const created = await res.json();
  assert.equal(res.status, 201, JSON.stringify(created));
  assert.match(created.id, /^lst-/);
  assert.deepEqual(created.groups, ['3@g.us']);

  const edited = await (await call(`/api/lists/${created.id}`, json('PUT', { name: 'Comunidade 2', groups: ['4@g.us'] }))).json();
  assert.equal(edited.id, created.id, 'o id não muda na edição');
  assert.equal(edited.name, 'Comunidade 2');

  assert.equal((await call(`/api/lists/${created.id}`, del())).status, 200);
  assert.equal((await (await call('/api/lists')).json()).length, 1);
  assert.equal((await call('/api/lists/lst-nope', del())).status, 404);
});

test('nome duplicado responde 409 e lista sem grupos responde 400', async (t) => {
  const call = await boot(t, newStore());
  const dup = await call('/api/lists', json('POST', { name: 'Ofertas SP', groups: ['9@g.us'] }));
  assert.equal(dup.status, 409);
  assert.match((await dup.json()).error, /nome duplicado/);

  const empty = await call('/api/lists', json('POST', { name: 'Vazia', groups: [] }));
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /ao menos um grupo/);
});

test('excluir lista em uso é recusado com o nome de quem usa', async (t) => {
  const call = await boot(t, newStore({
    schedules: [{ id: 'sch-a', name: 'Ofertas da manhã', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-a'] }],
  }));
  const res = await call('/api/lists/lst-a', del());
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /"Ofertas SP" é usada por: Ofertas da manhã/);
  assert.equal((await (await call('/api/lists')).json()).length, 1, 'a lista continua lá');
});
