import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-sch-')), 'schedules.json');
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

const novo = { name: 'bom-dia', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] };

test('cria, edita, alterna e exclui agendamento', async (t) => {
  const call = await boot(t, newStore());

  const criado = await (await call('/api/schedules', json('POST', novo))).json();
  assert.match(criado.id, /^sch-/);
  assert.equal(criado.enabled, true, 'enabled deve nascer true');

  const editado = await (await call(`/api/schedules/${criado.id}`,
    json('PUT', { ...novo, name: 'renomeado', cron: '0 10 * * 1' }))).json();
  assert.equal(editado.name, 'renomeado');
  assert.equal(editado.id, criado.id, 'renomear não pode trocar o id');

  const alternado = await (await call(`/api/schedules/${criado.id}`, json('PATCH', { enabled: false }))).json();
  assert.equal(alternado.enabled, false);
  assert.equal(alternado.name, 'renomeado', 'PATCH não pode mexer em outros campos');

  const delRes = await call(`/api/schedules/${criado.id}`, del());
  assert.equal(delRes.status, 200);
  assert.deepEqual(await (await call('/api/schedules')).json(), []);
});

test('id vindo do cliente é ignorado em POST', async (t) => {
  const call = await boot(t, newStore());

  const criado = await (await call('/api/schedules', json('POST', { ...novo, id: 'sch-forjado' }))).json();
  assert.notEqual(criado.id, 'sch-forjado');
  assert.match(criado.id, /^sch-/);
});

test('id vindo do cliente é ignorado em PUT', async (t) => {
  const call = await boot(t, newStore());
  const criado = await (await call('/api/schedules', json('POST', novo))).json();

  const editado = await (await call(`/api/schedules/${criado.id}`,
    json('PUT', { ...novo, id: 'sch-outro-id' }))).json();
  assert.equal(editado.id, criado.id, 'o id da URL prevalece sobre o id do corpo');

  const lista = await (await call('/api/schedules')).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, criado.id);
});

test('PATCH exige "enabled" booleano no corpo', async (t) => {
  const call = await boot(t, newStore());
  const criado = await (await call('/api/schedules', json('POST', novo))).json();

  const res = await call(`/api/schedules/${criado.id}`, json('PATCH', { name: 'outro-nome' }));
  assert.equal(res.status, 400);

  const inalterado = await (await call('/api/schedules')).json();
  assert.equal(inalterado[0].name, 'bom-dia', 'PATCH sem "enabled" não pode alterar nada');
});

test('excluir agendamento inexistente responde 404', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/schedules/sch-fantasma', del());
  assert.equal(res.status, 404);
});

test('cron inválido responde 400 e não grava', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/api/schedules', json('POST', { ...novo, cron: 'não-é-cron' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /cron inválida/);

  assert.deepEqual(await (await call('/api/schedules')).json(), []);
});

test('messageId inexistente responde 400', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/schedules', json('POST', { ...novo, messageId: 'msg-fantasma' }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /não existe/);
});

test('agendamento sem groups herda defaultGroups', async (t) => {
  const call = await boot(t, newStore());
  const { groups } = await (await call('/api/schedules', json('POST', { ...novo, groups: [] }))).json();

  assert.deepEqual(groups, ['111111111111111111@g.us']);
});

test('nome duplicado responde 400', async (t) => {
  const call = await boot(t, newStore());
  await call('/api/schedules', json('POST', novo));

  const res = await call('/api/schedules', json('POST', novo));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /duplicado/);

  const lista = await (await call('/api/schedules')).json();
  assert.equal(lista.length, 1, 'a segunda tentativa não pode ter gravado nada');
});

test('renomear agendamento para um nome já usado por outro responde 400', async (t) => {
  const call = await boot(t, newStore());
  await call('/api/schedules', json('POST', novo));
  const outro = await (await call('/api/schedules', json('POST', { ...novo, name: 'boa-noite' }))).json();

  const res = await call(`/api/schedules/${outro.id}`, json('PUT', { ...novo, name: 'bom-dia' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /duplicado/);
});

// A tela aceitava (201) um cron que só validate() aprova — "0 0 31W 2 *" — e
// o próximo boot do scheduler abortava por causa dele, sem outra saída além
// de editar o JSON na mão.
test('cron que o node-cron recusa registrar responde 400 e não grava', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/api/schedules', json('POST', { ...novo, cron: '0 0 31W 2 *' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /não é registrável/);

  assert.deepEqual(await (await call('/api/schedules')).json(), [],
    'nada pode ter sido gravado: é justamente o arquivo que faria o boot abortar');
});
