// Agendamento adiado pela janela de silêncio: no card e no status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scheduleList } from '../public/schedules-view.js';
import { startUi } from '../src/ui/server.js';

const SP = 'America/Sao_Paulo';
const NOW = Date.parse('2026-09-12T02:30:00Z');
const PENDING = { at: '2026-09-12T11:00:00.000Z', from: '2026-09-12T02:00:00.000Z', reason: 'quiet' };

test('card adiado mostra o badge e o fim da janela', () => {
  const html = scheduleList({
    schedules: [{ id: 'a', name: 'noturno', cron: '0 23 * * *', messageId: 'm', groups: ['1@g.us'], enabled: true, pending: PENDING }],
    messages: [{ id: 'm', name: 'Oi', text: 'x' }],
    nextRuns: { a: PENDING.at }, timeZone: SP, now: NOW,
  });
  assert.match(html, /badge tone-waiting"><span class="dot" aria-hidden="true"><\/span>Adiado</);
  // 11:00Z do dia 12 é 08:00 em SP, no dia seguinte a "agora" (23:30 do dia 11 em SP).
  assert.match(html, /Adiado para <strong>amanhã, 08:00<\/strong> · janela de silêncio/);
});

test('status devolve o fim da janela como próximo envio do adiado', async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-pending-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    messages: [{ id: 'm', name: 'Oi', text: 'x' }],
    schedules: [
      { id: 'a', name: 'noturno', cron: '0 23 * * *', messageId: 'm', groups: ['1@g.us'], pending: PENDING },
      { id: 'b', name: 'unico', at: '2026-01-01T10:00', messageId: 'm', groups: ['1@g.us'], pending: PENDING },
    ],
  }));
  const { server, port } = await startUi({ schedulesPath: path, cfg: { uiPort: 0, timezone: SP, logPath: join(tmpdir(), 'x.jsonl') } });
  t.after(() => server.close());
  const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  assert.equal(status.nextRuns.a, PENDING.at);
  assert.equal(status.nextRuns.b, PENDING.at, 'envio único adiado também aponta para o fim da janela');
});
