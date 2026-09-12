// Rotas dos ajustes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-settings-')), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [],
    ...extra,
  }));
  return path;
}

async function boot(t, schedulesPath) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0, timezone: 'America/Sao_Paulo' } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/settings devolve os padrões num arquivo sem o campo', async (t) => {
  const call = await boot(t, newStore());
  const settings = await (await call('/api/settings')).json();
  assert.deepEqual(settings, { paused: false, quietHours: null, hourlyLimit: 50, alerts: { whatsapp: true, pushUrl: '' } });
});

test('PUT /api/settings grava o objeto inteiro e devolve o gravado', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const body = { paused: true, quietHours: { start: '22:00', end: '08:00' }, hourlyLimit: 20, alerts: { whatsapp: false, pushUrl: 'https://ntfy.sh/x' } };
  const res = await call('/api/settings', json('PUT', body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), body);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).settings, body);

  // Campo ausente volta ao padrão: salvar só "paused" desliga a janela.
  const partial = await (await call('/api/settings', json('PUT', { paused: false }))).json();
  assert.equal(partial.quietHours, null);
  assert.equal(partial.hourlyLimit, 50);
});

test('PUT /api/settings com campo inválido responde 400 nomeando o campo e não grava', async (t) => {
  const path = newStore();
  const call = await boot(t, path);
  const res = await call('/api/settings', json('PUT', { hourlyLimit: 5000 }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /"hourlyLimit"/);
  assert.equal('settings' in JSON.parse(readFileSync(path, 'utf8')), false, 'nada foi gravado');
});
