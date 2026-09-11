import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  // 5xx que a aplicação escolhe de propósito, com mensagem própria — é o
  // que a rota GET /api/groups faz quando o WAHA não responde.
  'GET /api/upstream': async () => {
    const err = new Error('Erro 500 ao listar grupos em http://localhost:3994: sessão desconectada');
    err.status = 502;
    throw err;
  },
  'GET /api/circular': async () => {
    const body = {};
    body.self = body; // referência circular: JSON.stringify(body) lança.
    return { status: 200, body };
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

test('serve todos os módulos que a tela importa, como JavaScript', async (t) => {
  const call = await boot(t, newStore());
  // Segue os imports a partir do main.js: um módulo novo esquecido na lista
  // de estáticos quebraria a tela inteira no navegador sem nenhum teste falhar.
  const publicDir = new URL('../public/', import.meta.url);
  const files = new Set(['main.js']);
  const queue = ['main.js'];
  while (queue.length > 0) {
    const source = readFileSync(new URL(queue.shift(), publicDir), 'utf8');
    for (const [, name] of source.matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      if (!files.has(name)) {
        files.add(name);
        queue.push(name);
      }
    }
  }

  assert.ok(files.size >= 12, 'o main.js tem que alcançar todos os módulos da tela');
  for (const name of files) {
    const res = await call(`/${name}`);
    assert.equal(res.status, 200, `/${name} tem que ser servido`);
    assert.match(res.headers.get('content-type'), /text\/javascript/, name);
  }
});

// As fontes do design system ficam no repositório: a tela abre sem internet.
test('serve as fontes embutidas como font/woff2', async (t) => {
  const call = await boot(t, newStore());
  for (const name of ['geist.woff2', 'geist-mono.woff2']) {
    const res = await call(`/fonts/${name}`);
    assert.equal(res.status, 200, `/fonts/${name} tem que ser servido`);
    assert.equal(res.headers.get('content-type'), 'font/woff2', name);
    assert.ok((await res.arrayBuffer()).byteLength > 1000, `${name} não pode vir vazio`);
  }
});

// O anexo vai em base64 no corpo da mensagem: só as rotas de mensagem
// aceitam corpo grande. Nas outras, o limite de 1 MB continua.
test('corpo de 2 MB passa em /api/messages e leva 413 nas outras rotas', async (t) => {
  const call = await boot(t, newStore(), testRoutes);
  const big = 'A'.repeat(2_000_000);

  // Numa rota comum, pouco acima de 1 MB já é 413. Vai por socket cru porque
  // o servidor derruba a conexão sem ler tudo, e o fetch reporta isso como
  // erro de rede em vez de entregar a resposta. (Bem mais que o limite, como
  // os 2 MB, deixa tantos bytes por ler que o RST chega antes do 413.)
  const echoStatus = await new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ big: 'A'.repeat(1_100_000) }));
    const req = httpRequest({
      host: '127.0.0.1', port: call.port, method: 'POST', path: '/api/echo',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => {});
    req.end(body);
    setTimeout(() => resolve(undefined), 3000);
  });
  assert.equal(echoStatus, 413);

  const message = await call('/api/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Grande', text: 'x', media: { filename: 'a.bin', mimetype: 'application/octet-stream', data: big } }),
  });
  const created = await message.json();
  assert.equal(message.status, 201, JSON.stringify(created));
  assert.equal(created.media.size, 1_500_000);
});

test('loadConfig não expõe mais uiHost (UI_HOST não é lido)', () => {
  const cfg = loadConfig({ UI_HOST: '0.0.0.0', UI_PORT: '0' });
  assert.equal('uiHost' in cfg, false, 'uiHost não deve mais existir na config');
});

test('o bind é sempre 127.0.0.1, mesmo que cfg.uiHost venha preenchido com outro host', async (t) => {
  // Não basta provar que uiHost sumiu de loadConfig: alguém pode montar um
  // cfg manualmente (como startUi aceita) e injetar um host ali direto.
  // O bind em startUi tem que ignorar cfg.uiHost de qualquer jeito.
  const { server } = await startUi({
    schedulesPath: newStore(),
    cfg: { uiHost: '0.0.0.0', uiPort: 0 },
  });
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

// Nome antigo ("...e encerra a conexão") e a asserção `socketClosed === true`
// afirmavam provar que a correção derruba o socket — mas quem fecha o socket
// nesse cenário é o próprio Node (`Connection: close` com corpo não
// consumido), não `req.destroy()`: removendo o `req.destroy()` de
// `sendJsonAndClose`, esse teste continuava verde. O que a correção de
// verdade garante é que o servidor para de acumular bytes assim que passa de
// MAX_BODY_BYTES, em vez de bufferizar o corpo de 1.5MB inteiro antes de
// decidir — e isso este teste mede indiretamente pelo tempo de resposta.
test('corpo acima do limite responde 413 sem esperar o corpo inteiro chegar', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  // Corpo bem maior que o limite (1MB), mandado de uma vez — como um
  // cliente que já tem os bytes prontos e só está fazendo upload.
  const big = Buffer.alloc(1_500_000, 'a');
  const start = Date.now();

  const { status, elapsedMs } = await new Promise((resolve) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: call.port,
      method: 'POST',
      path: '/api/echo',
      headers: { 'Content-Type': 'application/json', 'Content-Length': big.length },
    });

    let settled = false;
    const finish = (statusCode) => {
      if (settled) return;
      settled = true;
      resolve({ status: statusCode, elapsedMs: Date.now() - start });
    };

    req.on('response', (res) => {
      res.resume();
      finish(res.statusCode);
    });
    req.on('error', () => {
      // Escrever o restante do corpo grande depois que o servidor já
      // respondeu 413 e parou de ler pode gerar EPIPE/ECONNRESET do lado do
      // cliente — esperado, não é falha do teste (e não é o que este teste
      // está verificando).
    });

    req.end(big);

    // Rede de segurança: se a resposta nunca chegar, falha no assert.equal
    // abaixo (status undefined) em vez de travar o teste.
    setTimeout(() => finish(undefined), 3000);
  });

  assert.equal(status, 413);
  assert.ok(elapsedMs < 1000, `resposta demorou ${elapsedMs}ms, esperado bem menos que 1s`);
});

test('body não serializável responde 500 e não derruba o processo', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/circular');
  assert.equal(res.status, 500);

  // Prova de que o processo segue vivo: uma requisição seguinte ainda
  // funciona. Sem a correção, a rejeição não tratada de JSON.stringify
  // depois de res.writeHead já ter saído derrubava o processo aqui.
  const res2 = await call('/');
  assert.equal(res2.status, 200);
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
  assert.equal(json.error, 'Erro interno do servidor.', 'erro inesperado continua genérico');
});

// O sanitizador transformava TODO status >= 500 em "Erro interno do
// servidor.", inclusive o 502 que a aplicação monta de propósito com a causa
// vinda do WAHA — a tela mostrava "Lista de grupos indisponível: Erro interno
// do servidor.", sem diagnóstico nenhum. A exceção vale só para status que a
// aplicação define deliberadamente, nunca para erro interno inesperado (o
// teste acima prende essa metade).
test('502 deliberado entrega a mensagem real, com a causa', async (t) => {
  const call = await boot(t, newStore(), testRoutes);

  const res = await call('/api/upstream');
  assert.equal(res.status, 502);

  const json = await res.json();
  assert.match(json.error, /sessão desconectada/, 'a causa tem que chegar à tela');
  assert.notEqual(json.error, 'Erro interno do servidor.');
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

// O entrypoint (`npm run ui`) morria com stack trace cru em inglês quando a
// porta estava ocupada — o caso mais provável, já que o WAHA local escuta em
// 3000. src/index.js já trata isso em português; a tela também precisa.

const UI_ENTRYPOINT = fileURLToPath(new URL('../src/ui/server.js', import.meta.url));

function runEntrypoint(env) {
  return new Promise((resolve) => {
    execFile('node', [UI_ENTRYPOINT], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

test('entrypoint com a porta ocupada explica o problema em português e sai com erro', async (t) => {
  // Ocupa uma porta e manda a tela subir exatamente nela.
  const blocker = createHttpServer(() => {});
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const porta = blocker.address().port;
  t.after(() => blocker.close());

  const { code, stderr } = await runEntrypoint({ UI_PORT: String(porta) });

  assert.equal(code, 1, 'a tela tem que sair com código de erro');
  assert.match(stderr, new RegExp(`porta ${porta} já está em uso`), 'a mensagem tem que dizer qual porta');
  assert.match(stderr, /UI_PORT/, 'e o que fazer a respeito');
  assert.ok(!/at .*server\.js:\d+/.test(stderr), `não pode sair stack trace cru: ${stderr}`);
  assert.ok(!/EADDRINUSE/.test(stderr), `não pode sair o erro cru em inglês: ${stderr}`);
});
