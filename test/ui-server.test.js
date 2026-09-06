import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../src/ui/server.js';

export function newStore(extra = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-ui-')), 'schedules.json');
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
  const { server, port } = await startUi({ schedulesPath, cfg: { uiHost: '127.0.0.1', uiPort: 0 } });
  t.after(() => server.close());
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

test('serve a página e escuta só em localhost', async (t) => {
  const call = await boot(t, newStore());

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<title>/);
});

test('rota desconhecida responde 404 em JSON', async (t) => {
  const call = await boot(t, newStore());
  const res = await call('/api/nao-existe');
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

test('recusa travessia de diretório nos estáticos', async (t) => {
  const call = await boot(t, newStore());

  for (const alvo of ['/../src/config.js', '/..%2fpackage.json', '/../../etc/passwd']) {
    const res = await call(alvo);
    assert.equal(res.status, 404, `${alvo} não pode ser servido`);
  }
});
