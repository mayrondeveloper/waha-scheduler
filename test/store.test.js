import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStore, updateStore } from '../src/ui/store.js';

function newStorePath() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-store-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({ version: 2, defaultGroups: [], messages: [], schedules: [] }));
  return path;
}

test('readStore devolve o store normalizado', () => {
  const path = newStorePath();
  const store = readStore(path);
  assert.equal(store.version, 2);
  assert.deepEqual(store.messages, []);
});

test('updateStore grava a mutação e devolve o resultado', async () => {
  const path = newStorePath();
  const saved = await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  assert.equal(saved.messages.length, 1);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).messages[0].text, 'Olá!');
});

test('updateStore recusa mutação inválida sem tocar no arquivo', async () => {
  const path = newStorePath();
  const antes = readFileSync(path, 'utf8');

  await assert.rejects(
    () => updateStore(path, (store) => {
      store.schedules.push({ name: 'x', cron: 'inválido', messageId: 'msg-a' });
      return store;
    }),
    /cron inválida/
  );

  assert.equal(readFileSync(path, 'utf8'), antes, 'arquivo não pode mudar em erro de validação');
});

test('não deixa arquivo temporário para trás', async () => {
  const path = newStorePath();
  await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  const restos = readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(restos, [], 'nenhum .tmp pode sobrar');
});

test('escritas concorrentes são serializadas, sem perder nenhuma', async () => {
  const path = newStorePath();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateStore(path, (store) => {
        store.messages.push({ id: `msg-${i}`, name: `M${i}`, text: `texto ${i}` });
        return store;
      })
    )
  );

  const final = readStore(path);
  assert.equal(final.messages.length, 10, 'nenhuma escrita pode ser perdida');
});
