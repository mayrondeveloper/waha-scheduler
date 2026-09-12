// Duplicar mensagem com anexo: POST /api/messages com media { id } de outra
// mensagem copia o arquivo para a nova.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startUi } from '../src/ui/server.js';
import { copyMedia, mediaPath } from '../src/media.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function newStore() {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-copy-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({ version: 2, messages: [], schedules: [] }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = () => ({ method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
const mediaFiles = (path) => readdirSync(join(dirname(path), 'media')).sort();

test('mensagem nova com media { id } de outra mensagem ganha uma cópia do arquivo', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const original = await (await call('/api/messages', json('POST', {
    name: 'Foto', text: 'Olá', media: { filename: 'pixel.png', mimetype: 'image/png', data: PNG },
  }))).json();

  const res = await call('/api/messages', json('POST', { name: 'Foto (cópia)', text: 'Olá', media: { id: original.media.id } }));
  const copy = await res.json();
  assert.equal(res.status, 201, JSON.stringify(copy));
  assert.notEqual(copy.media.id, original.media.id, 'a cópia tem arquivo próprio');
  assert.equal(copy.media.filename, 'pixel.png');
  assert.equal(copy.media.size, original.media.size);
  assert.deepEqual(mediaFiles(path), [`${original.media.id}.png`, `${copy.media.id}.png`].sort());

  // Excluir a original não afeta a cópia.
  assert.equal((await call(`/api/messages/${original.id}`, del())).status, 200);
  assert.deepEqual(mediaFiles(path), [`${copy.media.id}.png`]);
  assert.equal((await call(`/api/media/${copy.media.id}`)).status, 200);
});

test('media { id } que não é de nenhuma mensagem responde 400 e não deixa arquivo', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const res = await call('/api/messages', json('POST', { name: 'x', text: 'y', media: { id: 'med-nada' } }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /não é o anexo atual/);
  assert.equal((await (await call('/api/messages')).json()).length, 0);
});

test('copyMedia copia os bytes com id novo e nomeia o arquivo que falta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-copymedia-'));
  const media = { id: 'med-orig', filename: 'a.png', mimetype: 'image/png', size: 3, kind: 'image' };
  writeFileSync(mediaPath(dir, media), Buffer.from('abc'));
  const copy = copyMedia(dir, media);
  assert.match(copy.id, /^med-[0-9a-f]{8}$/);
  assert.equal(readFileSync(mediaPath(dir, copy), 'utf8'), 'abc');
  assert.throws(() => copyMedia(dir, { ...media, id: 'med-sumiu' }), /Anexo não encontrado: a\.png/);
});
