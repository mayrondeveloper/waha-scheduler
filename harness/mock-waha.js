// harness/mock-waha.js
// Mock mínimo da API WAHA para desenvolvimento e validação.
// Sobe em http://localhost:3999 e NUNCA envia mensagem real.
//
// Comportamento:
// - GET /api/:session/groups -> retorna 3 grupos, misturando id como
//   string e como objeto { _serialized }, igual aos engines reais do WAHA.
// - POST /api/sendText -> registra a chamada em memória.
//   chatId "999999999999999999@g.us" retorna 500 (para testar resiliência).
// - GET /__calls -> lista as chamadas de sendText recebidas (uso do harness).
// - POST /__reset -> limpa o registro de chamadas.

import http from 'node:http';

export const MOCK_PORT = 3999;
export const FAIL_GROUP_ID = '999999999999999999@g.us';

const GROUPS = [
  { id: '111111111111111111@g.us', name: 'Grupo Alpha' },
  { id: { _serialized: '222222222222222222@g.us' }, subject: 'Grupo Beta' },
  { id: { _serialized: FAIL_GROUP_ID }, name: 'Grupo Que Falha' },
];

export function startMockWaha(port = MOCK_PORT) {
  const calls = [];

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && /^\/api\/[^/]+\/groups$/.test(req.url)) {
      return send(200, GROUPS);
    }

    if (req.method === 'GET' && req.url === '/__calls') {
      return send(200, calls);
    }

    if (req.method === 'POST' && req.url === '/__reset') {
      calls.length = 0;
      return send(200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/api/sendText') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: 'JSON inválido' });
        }
        if (!body.chatId || !body.text || !body.session) {
          return send(400, { error: 'Campos obrigatórios: session, chatId, text' });
        }
        calls.push({ ts: Date.now(), ...body });
        if (body.chatId === FAIL_GROUP_ID) {
          return send(500, { error: 'Falha simulada pelo mock' });
        }
        return send(201, { id: `msg_${calls.length}`, ack: 1 });
      });
      return;
    }

    send(404, { error: `Rota não mockada: ${req.method} ${req.url}` });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, calls, port }));
  });
}

// Permite rodar standalone: node harness/mock-waha.js
if (import.meta.url === `file://${process.argv[1]}`) {
  startMockWaha().then(({ port }) =>
    console.log(`Mock WAHA rodando em http://localhost:${port}`)
  );
}
