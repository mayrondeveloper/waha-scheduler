import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startUi } from '../src/ui/server.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

async function boot(t, schedulesPath, cfg = {}) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0, ...cfg } });
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

// ---------- Anexo ----------

const withMedia = (extra = {}) => ({
  name: 'Foto', text: 'Olá', media: { filename: 'pixel.png', mimetype: 'image/png', data: PNG }, ...extra,
});
const mediaFiles = (schedulesPath) => {
  const dir = join(dirname(schedulesPath), 'media');
  return existsSync(dir) ? readdirSync(dir) : [];
};

test('cria mensagem com anexo, grava o arquivo ao lado do store e serve por /api/media', async (t) => {
  const path = newStore();
  const call = await boot(t, path);

  const res = await call('/api/messages', json('POST', withMedia()));
  const created = await res.json();
  assert.equal(res.status, 201, JSON.stringify(created));
  assert.match(created.media.id, /^med-/);
  assert.equal(created.media.kind, 'image');
  assert.equal(created.media.size, 70);
  assert.equal(created.media.filename, 'pixel.png');
  assert.equal('data' in created.media, false, 'o base64 não volta na resposta');
  assert.deepEqual(mediaFiles(path), [`${created.media.id}.png`]);

  const served = await call(`/api/media/${created.media.id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.match(served.headers.get('content-disposition'), /inline/);
  assert.equal(Buffer.from(await served.arrayBuffer()).toString('base64'), PNG);

  assert.equal((await call('/api/media/med-nao-existe')).status, 404);
});

test('editar mantém, troca e remove o anexo', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const created = await (await call('/api/messages', json('POST', withMedia()))).json();
  const url = `/api/messages/${created.id}`;

  const kept = await (await call(url, json('PUT', { name: 'Foto 2', text: 'Olá', media: { id: created.media.id } }))).json();
  assert.equal(kept.media.id, created.media.id, 'media: { id } mantém o anexo');
  assert.deepEqual(mediaFiles(path), [`${created.media.id}.png`]);

  const swapped = await (await call(url, json('PUT', withMedia({ name: 'Foto 2', media: { filename: 'outra.jpg', mimetype: 'image/jpeg', data: PNG } })))).json();
  assert.notEqual(swapped.media.id, created.media.id);
  assert.deepEqual(mediaFiles(path), [`${swapped.media.id}.jpg`], 'o arquivo antigo some');

  const removed = await (await call(url, json('PUT', { name: 'Foto 2', text: 'Olá' }))).json();
  assert.equal('media' in removed, false, 'sem media no corpo, o anexo sai');
  assert.deepEqual(mediaFiles(path), []);
});

test('excluir a mensagem apaga o arquivo do anexo', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const created = await (await call('/api/messages', json('POST', withMedia()))).json();
  assert.equal(mediaFiles(path).length, 1);

  assert.equal((await call(`/api/messages/${created.id}`, del())).status, 200);
  assert.deepEqual(mediaFiles(path), []);
});

test('anexo inválido responde 400 e não deixa arquivo', async (t) => {
  const path = newStore();
  const call = await boot(t, path, { maxMediaBytes: 10 });

  const cases = [
    [withMedia({ media: { filename: 'a.png', mimetype: 'png', data: PNG } }), /mimetype/],
    [withMedia({ media: { filename: 'a.png', mimetype: 'image/png', data: '***' } }), /base64/],
    [withMedia(), /passa do limite/],
  ];
  for (const [body, pattern] of cases) {
    const res = await call('/api/messages', json('POST', body));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, pattern);
  }
  assert.deepEqual(mediaFiles(path), []);
});

test('nome duplicado com anexo não deixa arquivo órfão', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const res = await call('/api/messages', json('POST', withMedia({ name: 'Oi' })));
  assert.equal(res.status, 400);
  assert.deepEqual(mediaFiles(path), []);
});
