// Pausa geral, adiamento pela janela de silêncio, vigia da sessão e alertas
// no agendador. Envio, cliente do WAHA, relógio e push são de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../src/index.js';
import { readStatus, statusPathFor } from '../src/scheduler-status.js';
import { instantToWall } from '../src/dates.js';
import { config } from '../src/config.js';

const TZ = 'America/Sao_Paulo';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newDir() {
  return mkdtempSync(join(tmpdir(), 'waha-guard-sched-'));
}

function writeConfig(path, { settings = {}, schedules }) {
  writeFileSync(path, JSON.stringify({
    version: 2,
    settings,
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules,
  }));
}

const readBack = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readLog = (logPath) => (existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

function fakes(dir, { status = 'WORKING' } = {}) {
  const sends = [];
  const alerts = [];
  const pushes = [];
  const client = {
    state: { status, me: { id: '5511999999999@c.us', pushName: 'Dono' } },
    async getSession() {
      if (client.state.status === 'DOWN') throw new Error('Falha de conexão ao consultar a sessão');
      return { status: client.state.status, me: client.state.me };
    },
    async sendText(chatId, text) { alerts.push({ chatId, text }); return {}; },
  };
  const fetchImpl = async (url, init) => { pushes.push({ url, title: init.headers.Title, body: init.body }); return { ok: true, status: 200 }; };
  const send = async (message, targets, opts) => {
    sends.push({ message, targets, opts });
    return { sent: targets.length, failed: 0, results: targets.map((chatId) => ({ chatId, status: 'sent' })) };
  };
  const cfg = { ...config, timezone: TZ, logPath: join(dir, 'sends.jsonl'), session: 'default' };
  return { sends, alerts, pushes, client, fetchImpl, send, cfg };
}

function boot(t, path, f, extra = {}) {
  const scheduler = startScheduler({
    schedulesPath: path, cfg: f.cfg, tickMs: 40, sessionPollMs: 40, send: f.send, client: f.client, fetchImpl: f.fetchImpl, ...extra,
  });
  t.after(() => scheduler.stop());
  return scheduler;
}

test('pausado: envio único vencido não dispara nem vira perdido; status diz pausado', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  writeConfig(path, {
    settings: { paused: true },
    schedules: [{ id: 'sch-once', name: 'promo', at: instantToWall(Date.now() - 60_000, TZ), messageId: 'msg-a', groups: ['1@g.us'] }],
  });
  const f = fakes(dir);
  const scheduler = boot(t, path, f);
  await delay(120);

  assert.equal(f.sends.length, 0);
  const saved = readBack(path).schedules[0];
  assert.equal('firedAt' in saved, false);
  assert.equal('missedAt' in saved, false);
  assert.equal(readStatus(statusPathFor(path)).paused, true);
  assert.deepEqual(scheduler.activeNames, ['promo']);
});

test('pausado: disparo do cron registra pulado no histórico e não envia', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  writeConfig(path, {
    settings: { paused: true },
    schedules: [{ id: 'sch-cron', name: 'cron', cron: '* * * * *', messageId: 'msg-a', groups: ['1@g.us', '2@g.us'] }],
  });
  const f = fakes(dir);
  const scheduler = boot(t, path, f);
  // O cron de verdade dispara no próximo minuto; aqui o teste chama o que ele chamaria.
  await scheduler.fire('sch-cron');

  assert.equal(f.sends.length, 0);
  const skipped = readLog(f.cfg.logPath);
  assert.deepEqual(skipped.map((e) => [e.status, e.chatId, e.reason, e.label]), [
    ['skipped', '1@g.us', 'paused', 'cron'],
    ['skipped', '2@g.us', 'paused', 'cron'],
  ]);
  assert.throws(() => scheduler.fire('sch-nope'), /não está registrado/);
});

test('janela de silêncio: disparo do cron vira adiado e não empilha um segundo', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  writeConfig(path, {
    settings: { quietHours: { start: '22:00', end: '08:00' } },
    schedules: [{ id: 'sch-cron', name: 'noturno', cron: '*/15 * * * *', messageId: 'msg-a', groups: ['1@g.us'] }],
  });
  const f = fakes(dir);
  const clock = Date.parse('2026-09-12T02:30:00Z'); // 23:30 em SP
  const scheduler = boot(t, path, f, { now: () => clock, tickMs: 60_000 });
  await scheduler.fire('sch-cron');
  await scheduler.fire('sch-cron');

  assert.equal(f.sends.length, 0);
  const saved = readBack(path).schedules[0];
  assert.deepEqual(saved.pending, { at: '2026-09-12T11:00:00.000Z', from: '2026-09-12T02:30:00.000Z', reason: 'quiet' });
  assert.deepEqual(readStatus(statusPathFor(path)).pending, ['noturno']);
});

test('janela de silêncio: envio único vencido vira adiado até o fim da janela, e o tique dispara depois com deferredFrom', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  // Relógio falso: 23:30 em SP (02:30Z), janela 22:00–08:00.
  let clock = Date.parse('2026-09-12T02:30:00Z');
  const at = instantToWall(clock - 60_000, TZ);
  writeConfig(path, {
    settings: { quietHours: { start: '22:00', end: '08:00' } },
    schedules: [{ id: 'sch-once', name: 'promo', at, messageId: 'msg-a', groups: ['1@g.us'] }],
  });
  const f = fakes(dir);
  const scheduler = boot(t, path, f, { now: () => clock, tickMs: 60_000 });
  await scheduler.tick();

  assert.equal(f.sends.length, 0, 'dentro da janela nada sai');
  let saved = readBack(path).schedules[0];
  assert.equal(saved.pending.reason, 'quiet');
  assert.equal(saved.pending.at, '2026-09-12T11:00:00.000Z', 'fim da janela: 08:00 em SP');
  assert.equal('firedAt' in saved, false);
  assert.deepEqual(readStatus(statusPathFor(path)).pending, ['promo']);

  // Um tique antes do fim não dispara.
  clock = Date.parse('2026-09-12T10:00:00Z');
  await scheduler.tick();
  assert.equal(f.sends.length, 0);

  // No fim da janela, dispara com deferredFrom e grava firedAt; pending some.
  clock = Date.parse('2026-09-12T11:00:00Z');
  await scheduler.tick();
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].opts.extra.deferredFrom, '2026-09-12T02:30:00.000Z');
  saved = readBack(path).schedules[0];
  assert.equal('pending' in saved, false);
  assert.equal(saved.firedAt, '2026-09-12T11:00:00.000Z');
});

test('adiamento gravado no arquivo sobrevive ao boot e não empilha outro', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  const pending = { at: '2026-09-12T11:00:00.000Z', from: '2026-09-12T02:00:00.000Z', reason: 'quiet' };
  writeConfig(path, {
    settings: { quietHours: { start: '22:00', end: '08:00' } },
    schedules: [{ id: 'sch-cron', name: 'noturno', cron: '0 23 * * *', messageId: 'msg-a', groups: ['1@g.us'], pending }],
  });
  const f = fakes(dir);
  let clock = Date.parse('2026-09-12T03:00:00Z');
  const scheduler = boot(t, path, f, { now: () => clock, tickMs: 60_000 });
  assert.deepEqual(scheduler.activeNames, ['noturno']);
  assert.deepEqual(readStatus(statusPathFor(path)).pending, ['noturno']);

  clock = Date.parse('2026-09-12T11:00:01Z');
  await scheduler.tick();
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].opts.extra.deferredFrom, pending.from);
  assert.equal(f.sends[0].opts.hourlyLimit, 50, 'o limite por hora dos ajustes vai para o envio');
  const saved = readBack(path).schedules[0];
  assert.equal('pending' in saved, false);
  assert.equal('firedAt' in saved, false, 'cron não ganha firedAt');
});

test('vigia da sessão: grava o estado no status e alerta nas transições', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  writeConfig(path, {
    settings: { alerts: { whatsapp: true, pushUrl: 'https://ntfy.sh/t' } },
    schedules: [{ id: 'sch-cron', name: 'cron', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] }],
  });
  const f = fakes(dir);
  const scheduler = boot(t, path, f, { sessionPollMs: 60_000 });
  await scheduler.pollSession();
  const status = readStatus(statusPathFor(path));
  assert.equal(status.waha.status, 'WORKING');
  assert.equal(status.waha.me.id, '5511999999999@c.us');
  assert.equal(f.alerts.length, 0, 'a primeira consulta é só a linha de base');

  f.client.state.status = 'STOPPED';
  await scheduler.pollSession();
  assert.equal(f.pushes.length, 1);
  assert.equal(f.pushes[0].title, 'Número desconectado');
  assert.match(f.pushes[0].body, /STOPPED/);
  assert.equal(f.alerts.length, 0, 'a queda não vai pelo WhatsApp');

  f.client.state.status = 'DOWN';
  await scheduler.pollSession();
  assert.equal(f.pushes.length, 1, 'continuar fora do ar não repete o alerta');
  assert.match(readStatus(statusPathFor(path)).waha.error, /Falha de conexão/);

  f.client.state.status = 'WORKING';
  await scheduler.pollSession();
  assert.equal(f.pushes.length, 2);
  assert.equal(f.pushes[1].title, 'Número reconectado');
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0].text, /\*Número reconectado\*/);
  assert.equal(f.alerts[0].chatId, '5511999999999@c.us');
});

test('disparo com falhas e envio único perdido avisam o dono', async (t) => {
  const dir = newDir();
  const path = join(dir, 'schedules.json');
  writeConfig(path, {
    settings: { alerts: { whatsapp: true, pushUrl: 'https://ntfy.sh/t' } },
    schedules: [
      { id: 'sch-lost', name: 'perdido', at: instantToWall(Date.now() - 20 * 60_000, TZ), messageId: 'msg-a', groups: ['1@g.us'] },
      { id: 'sch-fail', name: 'falha', at: instantToWall(Date.now() - 30_000, TZ), messageId: 'msg-a', groups: ['1@g.us', '2@g.us'] },
    ],
  });
  const f = fakes(dir);
  f.send = async (message, targets) => ({
    sent: 1, failed: 1, results: [{ chatId: targets[0], status: 'sent' }, { chatId: targets[1], status: 'error', error: 'Erro 500 ao enviar para 2@g.us' }],
  });
  const scheduler = boot(t, path, f, { tickMs: 60_000 });
  await scheduler.pollSession();
  await scheduler.tick();

  const titles = f.pushes.map((p) => p.title).sort();
  assert.deepEqual(titles, ['Envio único perdido: perdido', 'Falha no envio: falha']);
  assert.equal(f.alerts.length, 2);
  assert.match(f.alerts.find((a) => a.text.includes('Falha no envio')).text, /1 de 2 grupo\(s\) falharam\. Primeiro erro: Erro 500/);
});
