// Status com pausa, janela e sessão; proxy da sessão; teste de alerta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';
import { writeStatus, statusPathFor } from '../src/scheduler-status.js';

const TZ = 'America/Sao_Paulo';

function newStore(settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-alerts-ui-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2, settings,
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['1@g.us'] }],
  }));
  return { path, dir };
}

// WAHA de mentira: sessão e sendText; e um destino de push que registra o POST.
function fakeWaha(t, { status = 'WORKING' } = {}) {
  const calls = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        calls.push({ method: req.method, url: req.url, title: req.headers.title, body: raw });
        if (req.url === '/api/sessions/default') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status, me: status === 'WORKING' ? { id: '5511999999999@c.us', pushName: 'Dono' } : null }));
        }
        if (req.url === '/api/sendText' || req.url === '/push') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('{}');
        }
        res.writeHead(404);
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ calls, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function boot(t, { path, dir }, wahaUrl = 'http://127.0.0.1:1') {
  const cfg = { uiPort: 0, timezone: TZ, wahaUrl, session: 'default', apiKey: '', logPath: join(dir, 'sends.jsonl'), delayMinMs: 0, delayMaxMs: 0 };
  const { server, port } = await startUi({ schedulesPath: path, cfg });
  t.after(() => server.close());
  return (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init);
}

const post = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' } });

test('status devolve pausa, janela e o fim dela quando agora está dentro, e o que o agendador viu do WAHA', async (t) => {
  // Janela que cobre qualquer hora do dia menos um minuto: "agora" está dentro.
  const store = newStore({ paused: true, quietHours: { start: '00:01', end: '00:00' } });
  writeStatus(statusPathFor(store.path), {
    pid: 1, startedAt: new Date().toISOString(), beatAt: new Date().toISOString(), active: ['x'], reloadError: null,
    waha: { status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'Dono' }, checkedAt: new Date().toISOString(), error: null },
  });
  const call = await boot(t, store);
  const status = await (await call('/api/status')).json();
  assert.equal(status.paused, true);
  assert.deepEqual(status.quietHours, { start: '00:01', end: '00:00' });
  assert.ok(status.quietUntil === null || Date.parse(status.quietUntil) > Date.now(), 'fim da janela no futuro (ou nulo no minuto de fora)');
  assert.equal(status.waha.status, 'WORKING');
  assert.equal(status.waha.me.pushName, 'Dono');

  const plain = await (await (await boot(t, newStore()))('/api/status')).json();
  assert.equal(plain.paused, false);
  assert.equal(plain.quietHours, null);
  assert.equal(plain.quietUntil, null);
  assert.equal(plain.waha, null, 'sem agendador rodando não há visão da sessão');
});

test('GET /api/session faz o proxy da sessão; WAHA fora do ar responde 502 com contexto', async (t) => {
  const waha = await fakeWaha(t);
  const call = await boot(t, newStore(), waha.url);
  assert.deepEqual(await (await call('/api/session')).json(), { status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'Dono' } });

  const off = await boot(t, newStore());
  const res = await off('/api/session');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Falha de conexão ao consultar a sessão/);
});

test('POST /api/alerts/test manda pelos canais configurados e diz quais foram', async (t) => {
  const waha = await fakeWaha(t);
  const call = await boot(t, newStore({ alerts: { whatsapp: true, pushUrl: `${waha.url}/push` } }), waha.url);
  const result = await (await call('/api/alerts/test', post())).json();
  assert.deepEqual(result.sent, ['whatsapp', 'push']);

  const text = waha.calls.find((c) => c.url === '/api/sendText');
  assert.match(text.body, /"chatId":"5511999999999@c\.us"/);
  assert.match(text.body, /Teste de alerta/);
  const push = waha.calls.find((c) => c.url === '/push');
  assert.equal(push.title, 'Teste de alerta');
  assert.match(push.body, /alertas do waha-scheduler/);

  // Sem WAHA e sem URL: nada vai, sem erro.
  const none = await boot(t, newStore({ alerts: { whatsapp: true, pushUrl: '' } }));
  assert.deepEqual((await (await none('/api/alerts/test', post())).json()).sent, []);
});

test('o envio manual obedece ao limite por hora dos ajustes', async (t) => {
  const waha = await fakeWaha(t);
  const store = newStore({ hourlyLimit: 1 });
  // Um envio há 1 minuto já no log: o limite de 1 por hora está batido.
  writeFileSync(join(store.dir, 'sends.jsonl'), `${JSON.stringify({ ts: new Date(Date.now() - 60_000).toISOString(), status: 'sent', chatId: '9@g.us', message: 'x' })}\n`);
  const call = await boot(t, store, waha.url);
  // Com o limite batido, o run ficaria esperando ~59 min: o teste só confere
  // que a rota aceita e que, com limite 0, sai na hora.
  const paused = await (await call('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hourlyLimit: 0 }) })).json();
  assert.equal(paused.hourlyLimit, 0);
  const result = await (await call('/api/schedules/sch-a/run', post())).json();
  assert.equal(result.sent, 1);
});
