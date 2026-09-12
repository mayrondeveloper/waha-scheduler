// Freio por hora e spintax no envio. Client injetado, sem rede; relógio e
// sleep de mentira para o freio não esperar de verdade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { broadcast } from '../src/broadcast.js';

function makeCfg() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-guard-'));
  return { wahaUrl: 'http://localhost:0', session: 'default', apiKey: '', delayMinMs: 0, delayMaxMs: 0, logPath: join(dir, 'sends.jsonl') };
}

function fakeClient() {
  const calls = [];
  return { calls, async sendText(chatId, text) { calls.push({ chatId, text }); return { id: `m${calls.length}` }; } };
}

const readLog = (cfg) => readFileSync(cfg.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Relógio falso: o sleep avança o tempo em vez de esperar.
function fakeClock(startMs) {
  let t = startMs;
  const slept = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept };
}

test('cada grupo recebe uma variação sorteada, e o log guarda o texto que saiu', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  let i = 0;
  const random = () => (i++ % 2 === 0 ? 0 : 0.99);
  await broadcast('{Bom dia|Olá}, grupo!', ['1@g.us', '2@g.us'], { client, cfg, random });

  assert.deepEqual(client.calls.map((c) => c.text), ['Bom dia, grupo!', 'Olá, grupo!']);
  assert.deepEqual(readLog(cfg).map((e) => e.message), ['Bom dia, grupo!', 'Olá, grupo!']);
});

test('freio: no limite, espera até o envio mais antigo da janela sair dela, e registra waitedMs', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const clock = fakeClock(Date.parse('2026-09-12T12:00:00Z'));
  // Dois envios na última hora já no log (da tela, por exemplo): um há 50 min e outro há 10 min.
  writeFileSync(cfg.logPath, [
    JSON.stringify({ ts: new Date(clock.now() - 50 * 60_000).toISOString(), status: 'sent', chatId: '9@g.us', message: 'x' }),
    JSON.stringify({ ts: new Date(clock.now() - 10 * 60_000).toISOString(), status: 'sent', chatId: '9@g.us', message: 'x' }),
  ].join('\n') + '\n');

  const result = await broadcast('oi', ['1@g.us', '2@g.us'], { client, cfg, hourlyLimit: 2, now: clock.now, sleep: clock.sleep });

  assert.equal(result.sent, 2);
  const entries = readLog(cfg).slice(2);
  // O primeiro grupo esperou os ~10 min que faltavam para o envio de 50 min atrás completar 1 h.
  assert.ok(entries[0].waitedMs >= 10 * 60_000 && entries[0].waitedMs < 11 * 60_000, `esperou ${entries[0].waitedMs}`);
  // Depois dele, a janela tem 2 de novo (o de 10 min atrás e este): o segundo espera até o de 10 min sair.
  assert.ok(entries[1].waitedMs > 0);
  assert.equal(clock.slept.length >= 2, true);
  const ts = entries.map((e) => Date.parse(e.ts));
  assert.ok(ts[1] >= ts[0]);
});

test('freio desligado (0) e abaixo do limite: nenhuma espera e nenhum waitedMs', async () => {
  const cfg = makeCfg();
  const client = fakeClient();
  const clock = fakeClock(Date.now());
  await broadcast('oi', ['1@g.us', '2@g.us', '3@g.us'], { client, cfg, hourlyLimit: 0, now: clock.now, sleep: clock.sleep });
  assert.deepEqual(clock.slept, [0, 0], 'só os intervalos entre grupos, que são zero neste cfg');
  assert.ok(readLog(cfg).every((e) => !('waitedMs' in e)));

  const cfg2 = makeCfg();
  const clock2 = fakeClock(Date.now());
  await broadcast('oi', ['1@g.us', '2@g.us'], { client: fakeClient(), cfg: cfg2, hourlyLimit: 5, now: clock2.now, sleep: clock2.sleep });
  assert.ok(readLog(cfg2).every((e) => !('waitedMs' in e)));
});

test('campos extras vão em cada linha do log', async () => {
  const cfg = makeCfg();
  await broadcast('oi', ['1@g.us'], { client: fakeClient(), cfg, extra: { deferredFrom: '2026-09-12T02:00:00.000Z' } });
  assert.equal(readLog(cfg)[0].deferredFrom, '2026-09-12T02:00:00.000Z');
});
