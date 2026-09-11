import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_CATEGORIES, recentEmojis, rememberEmoji } from '../public/emoji.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

test('categorias com emojis, sem repetição entre elas', () => {
  const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
  assert.deepEqual(EMOJI_CATEGORIES.map((c) => c.id), ['faces', 'people', 'nature', 'objects', 'symbols']);
  assert.ok(EMOJI_CATEGORIES.every((c) => c.emojis.length >= 30), 'cada categoria precisa ter ao menos 30 emojis');
  assert.ok(all.every((e) => e.trim() !== ''), 'nenhum emoji vazio');
  assert.equal(new Set(all).size, all.length, 'nenhum emoji repetido');
});

test('recentes: o último usado vem primeiro, sem repetir, até 20', () => {
  const storage = memoryStorage();
  rememberEmoji(storage, '📚');
  rememberEmoji(storage, '🔥');
  rememberEmoji(storage, '📚');
  assert.deepEqual(recentEmojis(storage), ['📚', '🔥']);
  for (let i = 0; i < 30; i += 1) rememberEmoji(storage, String(i));
  assert.equal(recentEmojis(storage).length, 20);
});

test('sem armazenamento disponível, recentes fica vazio e nada quebra', () => {
  const blocked = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(recentEmojis(blocked), []);
  assert.deepEqual(rememberEmoji(blocked, '📚'), ['📚']);
  assert.deepEqual(recentEmojis(undefined), []);
});
