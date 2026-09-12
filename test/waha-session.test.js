// getSession contra um servidor local que imita a rota de sessão do WAHA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getSession } from '../src/waha/client.js';

function fakeWaha(t, handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ wahaUrl: `http://127.0.0.1:${server.address().port}`, session: 'default', apiKey: 'k' });
    });
  });
}

test('devolve o status e a identidade do número, mandando a chave', async (t) => {
  let seenKey = null;
  const cfg = await fakeWaha(t, (req, res) => {
    seenKey = req.headers['x-api-key'];
    assert.equal(req.url, '/api/sessions/default');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'default', status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'Dono', lid: 'x' } }));
  });
  assert.deepEqual(await getSession(cfg), { status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'Dono' } });
  assert.equal(seenKey, 'k');
});

test('sessão sem "me" (aguardando QR) devolve me nulo; erro e resposta estranha têm contexto', async (t) => {
  const cfg = await fakeWaha(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'default', status: 'SCAN_QR_CODE' }));
  });
  assert.deepEqual(await getSession(cfg), { status: 'SCAN_QR_CODE', me: null });

  const bad = await fakeWaha(t, (req, res) => { res.writeHead(404); res.end('{"error":"no session"}'); });
  await assert.rejects(() => getSession(bad), /Erro 404 ao consultar a sessão em http:\/\/127\.0\.0\.1:\d+\/api\/sessions\/default/);

  const weird = await fakeWaha(t, (req, res) => { res.writeHead(200); res.end('{"x":1}'); });
  await assert.rejects(() => getSession(weird), /Resposta inesperada/);

  await assert.rejects(() => getSession({ wahaUrl: 'http://127.0.0.1:1', session: 'default', apiKey: '' }), /Falha de conexão ao consultar a sessão/);
});
