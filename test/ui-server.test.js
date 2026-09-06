import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startUi } from '../src/ui/server.js';
import { loadConfig } from '../src/config.js';

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

// Rotas mínimas usadas só pelos testes, para exercitar o roteador, o
// readBody e o caminho de erro (nenhuma delas existe na aplicação real
// ainda — isso vem nas Tasks 6-8).
const testRoutes = {
  'POST /api/echo': async ({ body }) => ({ status: 200, body }),
  'DELETE /api/messages/:id': async ({ params }) => ({ status: 200, body: { id: params.id } }),
  'GET /api/boom': async () => {
    throw new Error("ENOENT: no such file or directory, open '/Users/x/data/schedules.json'");
  },
};

async function boot(t, schedulesPath, routes = {}) {
  const { server, port } = await startUi({ schedulesPath, cfg: { uiPort: 0 }, routes });
  t.after(() => server.close());
  const call = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
  call.port = port;
  return call;
}

// Requisição HTTP crua, para casos que o fetch não permite controlar
// (cabeçalho Host forjado, ausência total de Content-Type).
function rawRequest(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, ...options }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, raw, socket: req.socket }));
    });
    req.on('error', reject);
    req.end(body);
  });
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

test('o bind é sempre 127.0.0.1, mesmo com UI_HOST=0.0.0.0 no ambiente', async (t) => {
  const cfg = loadConfig({ UI_HOST: '0.0.0.0', UI_PORT: '0' });
  assert.equal('uiHost' in cfg, false, 'uiHost não deve mais existir na config');

  const { server } = await startUi({ schedulesPath: newStore(), cfg });
  t.after(() => server.close());

  assert.equal(server.address().address, '127.0.0.1');
});

test('rota mutante com Content-Type errado responde 415', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ text: 'oi' }),
  });
  assert.equal(res.status, 415);
});

test('rota mutante sem Content-Type nenhum responde 415', async (t) => {
  const call = await boot(t, newStore(), testRoutes);
  const { status } = await rawRequest(
    call.port,
    { method: 'POST', path: '/api/echo' },
    JSON.stringify({ text: 'oi' })
  );
  assert.equal(status, 415);
});

test('Origin cross-origin responde 403', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

test('cabeçalho Host forjado responde 403', async (t) => {
  const call = await boot(t, newStore(), testRoutes);
  const { status } = await rawRequest(call.port, {
    method: 'GET',
    path: '/',
    headers: { Host: 'evil.example' },
  });
  assert.equal(status, 403);
});

test('URL malformada (%zz) num parâmetro responde 400 e o processo segue vivo', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/messages/%zz', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);

  // Prova de que o processo segue vivo: uma requisição seguinte ainda funciona.
  const res2 = await call('/');
  assert.equal(res2.status, 200);
});

test('JSON inválido no corpo responde 400', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ isso não é json',
  });
  assert.equal(res.status, 400);
});

test('corpo acima do limite responde 413 e encerra a conexão', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  // Corpo bem maior que o limite (1MB), mandado de uma vez — como um
  // cliente que já tem os bytes prontos e só está fazendo upload.
  const big = Buffer.alloc(1_500_000, 'a');

  const { status, socketClosed } = await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: call.port,
      method: 'POST',
      path: '/api/echo',
      headers: { 'Content-Type': 'application/json', 'Content-Length': big.length },
    });

    let status;
    let socketClosed = false;

    req.on('response', (res) => {
      status = res.statusCode;
      res.resume();
      res.socket.on('close', () => {
        socketClosed = true;
        resolve({ status, socketClosed });
      });
    });
    req.on('error', () => {
      // Escrever o restante do corpo depois que o servidor já respondeu e
      // fechou a leitura é esperado (EPIPE/ECONNRESET) — não é falha do teste.
    });

    req.end(big);

    setTimeout(() => resolve({ status, socketClosed }), 2000);
  });

  assert.equal(status, 413);
  assert.equal(socketClosed, true, 'a conexão deveria ter sido encerrada pelo servidor');
});

test('parâmetro de rota inválido responde 400', async (t) => {
  const call = await boot(t, newStore(), testRoutes);
  const headers = { 'Content-Type': 'application/json' };

  const vazio = await call('/api/messages/', { method: 'DELETE', headers });
  assert.equal(vazio.status, 400);

  const comBarra = await call('/api/messages/%2f', { method: 'DELETE', headers });
  assert.equal(comBarra.status, 400);

  const comTravessia = await call('/api/messages/..%2f..%2fetc%2fpasswd', {
    method: 'DELETE',
    headers,
  });
  assert.equal(comTravessia.status, 400);

  const comNul = await call('/api/messages/%00', { method: 'DELETE', headers });
  assert.equal(comNul.status, 400);
});

test('rota exata não casa chave dinâmica', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/messages/:id', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.id, ':id');
});

test('erro 5xx não vaza caminho de arquivo na resposta', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/boom');
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes('/'), `mensagem não pode conter caminho: ${json.error}`);
  assert.ok(!/ENOENT/.test(json.error));
});

test('corpo UTF-8 partido entre dois chunks TCP chega íntegro', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const text = 'Olá, é um teste com açúcar!';
  const payload = Buffer.from(JSON.stringify({ text }), 'utf8');
  // Corta bem no meio de um caractere multibyte (o primeiro byte de "á").
  const splitIndex = payload.indexOf(0xc3) + 1;
  const part1 = payload.subarray(0, splitIndex);
  const part2 = payload.subarray(splitIndex);
  assert.ok(part1.length > 0 && part2.length > 0, 'o corte precisa cair no meio do payload');

  const received = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: call.port,
        method: 'POST',
        path: '/api/echo',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve(JSON.parse(raw)));
      }
    );
    req.on('error', reject);
    req.write(part1);
    setTimeout(() => {
      req.write(part2);
      req.end();
    }, 20);
  });

  assert.equal(received.text, text);
});
