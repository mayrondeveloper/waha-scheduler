import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-msg-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['111111111111111111@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Servidor exige Content-Type: application/json em toda rota mutante,
// incluindo DELETE — sem corpo, mas o cabeçalho continua obrigatório.
const del = () => ({ method: 'DELETE', headers: { 'Content-Type': 'application/json' } });

test('lista, cria, edita e exclui mensagem', async (t) => {
  const call = await boot(t, newStore());

  const lista = await (await call('/api/messages')).json();
  assert.equal(lista.length, 1);

  const criada = await (await call('/api/messages', json('POST', { name: 'Nova', text: 'Texto' }))).json();
  assert.match(criada.id, /^msg-/);
  assert.equal(criada.name, 'Nova');

  const editada = await (await call(`/api/messages/${criada.id}`, json('PUT', { name: 'Editada', text: 'Outro' }))).json();
  assert.equal(editada.name, 'Editada');
  assert.equal(editada.id, criada.id, 'o id não pode mudar na edição');

  const delRes = await call(`/api/messages/${criada.id}`, del());
  assert.equal(delRes.status, 200);
  assert.equal((await (await call('/api/messages')).json()).length, 1);
});

test('criar mensagem sem texto responde 400', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/messages', json('POST', { name: 'Só nome' }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /"text" é obrigatório/);
});

test('excluir mensagem em uso responde 409 e não altera nada', async (t) => {
  const path = newStore({
    schedules: [{ id: 'sch-a', name: 'usa-a-msg', cron: '0 9 * * 1', messageId: 'msg-a' }],
  });
  const call = await boot(t, path);

  const res = await call('/api/messages/msg-a', del());
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /usa-a-msg/);

  assert.equal((await (await call('/api/messages')).json()).length, 1, 'mensagem preservada');
});

test('editar mensagem inexistente responde 404', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/messages/msg-fantasma', json('PUT', { name: 'x', text: 'y' }));
  assert.equal(res.status, 404);
});

test('excluir mensagem inexistente responde 404', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/messages/msg-fantasma', del());
  assert.equal(res.status, 404);
});

// O README promete "name" único entre mensagens; sem esta validação, duas
// mensagens homônimas com textos diferentes viravam duas opções idênticas no
// <select> do formulário de agendamento — o usuário escolhe a errada e o
// grupo recebe o texto errado.

test('criar mensagem com nome já usado responde 400, nomeia o conflito e não grava', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/api/messages', json('POST', { name: 'Oi', text: 'Outro texto!' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /"Oi".*duplicado/);

  const lista = await (await call('/api/messages')).json();
  assert.equal(lista.length, 1, 'a segunda tentativa não pode ter gravado nada');
  assert.equal(lista[0].text, 'Olá!', 'a mensagem original não pode ter sido alterada');
});

test('renomear mensagem para um nome já usado por outra responde 400', async (t) => {
  const call = await boot(t, newStore());
  const criada = await (await call('/api/messages', json('POST', { name: 'Tchau', text: 'Até!' }))).json();

  const res = await call(`/api/messages/${criada.id}`, json('PUT', { name: 'Oi', text: 'Até!' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /duplicado/);

  const lista = await (await call('/api/messages')).json();
  assert.equal(lista.find((m) => m.id === criada.id).name, 'Tchau', 'o nome não pode ter mudado');
});

test('editar mensagem mantendo o próprio nome continua permitido', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/api/messages/msg-a', json('PUT', { name: 'Oi', text: 'Olá de novo!' }));
  assert.equal(res.status, 200, 'um registro não pode ser acusado de ser duplicata de si mesmo');
  assert.equal((await res.json()).text, 'Olá de novo!');
});
