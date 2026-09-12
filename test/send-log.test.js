import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSendLog, recentSends, countRecentSends, HOUR_MS } from '../src/send-log.js';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const line = (minutesAgo, status = 'sent') =>
  JSON.stringify({ ts: new Date(NOW - minutesAgo * 60_000).toISOString(), status, chatId: '1@g.us', message: 'x' });

function logWith(lines) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-sendlog-')), 'sends.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

test('arquivo ausente é log vazio; linha corrompida é descartada', () => {
  assert.deepEqual(readSendLog('/caminho/que/nao/existe.jsonl'), []);
  const path = logWith([line(5), '{ quebrada', line(3)]);
  assert.equal(readSendLog(path).length, 2);
});

test('conta só os envios com sucesso dentro da janela, e devolve os instantes em ordem', () => {
  const path = logWith([line(90), line(50), line(10, 'error'), line(30), line(5)]);
  assert.equal(countRecentSends(path, { now: NOW }), 3, '90 min atrás está fora; o erro não conta');
  assert.deepEqual(recentSends(path, { now: NOW }), [NOW - 50 * 60_000, NOW - 30 * 60_000, NOW - 5 * 60_000]);
  assert.equal(countRecentSends(path, { now: NOW, windowMs: 20 * 60_000 }), 1);
  assert.equal(HOUR_MS, 3_600_000);
});
