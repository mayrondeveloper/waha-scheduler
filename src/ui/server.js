// Servidor HTTP local da tela de agendamentos.
// O host é sempre 127.0.0.1, sem escotilha por env: é essa inalcançabilidade
// de fora que dispensa autenticação própria nesta tela — não removê-la sem
// implementar autenticação antes.

import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { config } from '../config.js';
import { info, error } from '../logger.js';
import { messageRoutes } from './routes/messages.js';
import { scheduleRoutes } from './routes/schedules.js';
import { actionRoutes } from './routes/actions.js';
import { listRoutes } from './routes/lists.js';
import { settingsRoutes } from './routes/settings.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const MAX_BODY_BYTES = 1_000_000;
// O anexo vai em base64 dentro do corpo da mensagem (16 MB viram 21,4 MB):
// só as rotas de mensagem aceitam corpo grande.
const MEDIA_BODY_BYTES = 24_000_000;
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function bodyLimitFor(path) {
  return /^\/api\/messages(\/[^/]+)?$/.test(path) ? MEDIA_BODY_BYTES : MAX_BODY_BYTES;
}

// Status 5xx que a APLICAÇÃO escolhe deliberadamente, com mensagem escrita
// por nós: hoje só o 502 de "o WAHA não respondeu", cuja mensagem é o
// diagnóstico que o usuário precisa ler na tela ("Lista de grupos
// indisponível: Erro interno do servidor." não diz nada). Qualquer outro
// 5xx continua genérico — é erro inesperado, e foi um deles que já vazou
// caminho absoluto do servidor na resposta. Nunca acrescente 500 aqui.
const DELIBERATE_5XX = new Set([502]);

// Lista fixa: o caminho servido nunca é montado a partir da URL. Todo módulo
// que a tela importa precisa estar aqui (o teste de estáticos confere).
const JS = 'text/javascript; charset=utf-8';
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/main.js': ['main.js', JS],
  '/app.js': ['app.js', JS],
  '/api.js': ['api.js', JS],
  '/html.js': ['html.js', JS],
  '/cron.js': ['cron.js', JS],
  '/dates.js': ['dates.js', JS],
  '/whatsapp.js': ['whatsapp.js', JS],
  '/emoji.js': ['emoji.js', JS],
  '/history.js': ['history.js', JS],
  '/status-view.js': ['status-view.js', JS],
  '/schedules-view.js': ['schedules-view.js', JS],
  '/messages-view.js': ['messages-view.js', JS],
  '/history-view.js': ['history-view.js', JS],
  '/media.js': ['media.js', JS],
  '/lists-view.js': ['lists-view.js', JS],
  '/spintax.js': ['spintax.js', JS],
  // Fontes do design system, embutidas: a tela não carrega nada da internet.
  '/fonts/geist.woff2': ['fonts/geist.woff2', 'font/woff2'],
  '/fonts/geist-mono.woff2': ['fonts/geist-mono.woff2', 'font/woff2'],
};

// Descreve qualquer valor lançado como texto útil para log — inclusive
// quando o handler lança algo que não é Error (string, número, objeto
// solto). `err.message` sozinho vira `undefined` nesses casos e, jogado
// direto em `error(...)`, produz uma linha de log vazia (nunca engolir erro
// em silêncio é regra do projeto).
function describeError(err) {
  if (err instanceof Error) return err.message || err.stack || String(err);
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Serializa antes de escrever qualquer coisa no response. Se `JSON.stringify`
// falhar (referência circular, BigInt, etc.) depois do header já ter saído,
// o erro vira ERR_HTTP_HEADERS_SENT — uma rejeição não tratada que derruba o
// processo. Serializando primeiro, um body ruim vira 500 controlado.
function serializeBody(body) {
  try {
    return JSON.stringify(body);
  } catch (err) {
    error(`Não foi possível serializar a resposta JSON: ${describeError(err)}`);
    return null;
  }
}

function sendJson(res, status, body) {
  const payload = serializeBody(body);
  if (payload === null) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Erro interno do servidor.' }));
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// Responde e, só depois de os bytes saírem para o socket, encerra a conexão —
// usado quando o corpo estourou o limite, para não deixar o cliente continuar
// mandando dados.
function sendJsonAndClose(req, res, status, body) {
  const payload = serializeBody(body);
  const finalStatus = payload === null ? 500 : status;
  const finalPayload = payload === null ? JSON.stringify({ error: 'Erro interno do servidor.' }) : payload;

  res.writeHead(finalStatus, { Connection: 'close', 'Content-Type': 'application/json; charset=utf-8' });
  res.end(finalPayload);
  // Espera a resposta ser entregue e o restante do corpo em trânsito ser
  // drenado antes de derrubar o socket — encerrar cedo demais, com bytes
  // ainda não lidos no buffer do SO, gera RST e descarta a resposta.
  res.once('finish', () => setTimeout(() => req.destroy(), 50));
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let raw = '';
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > limit) {
        settled = true;
        const err = new Error('Corpo da requisição grande demais.');
        err.status = 413;
        reject(err);
        return;
      }
      raw += decoder.write(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      raw += decoder.end();
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('JSON inválido no corpo da requisição.');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function hasJsonContentType(req) {
  const contentType = req.headers['content-type'];
  if (!contentType) return false;
  return /^application\/json\s*(;.*)?$/i.test(contentType.trim());
}

function isAllowedHost(hostHeader, port) {
  if (!hostHeader) return false;
  return (
    hostHeader === `127.0.0.1:${port}` ||
    hostHeader === `localhost:${port}` ||
    hostHeader === `[::1]:${port}`
  );
}

function isSameOriginHeader(originHeader, port) {
  return originHeader === `http://127.0.0.1:${port}` || originHeader === `http://localhost:${port}`;
}

function isInvalidParam(value) {
  return (
    value === '' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..') ||
    value.includes('\0')
  );
}

/**
 * Cria o servidor da UI sem iniciá-lo.
 * @param {{schedulesPath?: string, cfg?: object, routes?: object}} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  const { schedulesPath = config.schedulesPath, cfg = config, routes: extra = {} } = options;
  // As rotas da aplicação vêm primeiro; `extra` (testes, ou futuras Tasks)
  // pode sobrepor por chave — é o que os testes de rota crua do servidor
  // (test/ui-server.test.js) fazem para exercitar o roteador isoladamente.
  const routes = { ...messageRoutes, ...scheduleRoutes, ...listRoutes, ...settingsRoutes, ...actionRoutes, ...extra };

  const server = createHttpServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'URL malformada.' });
    }
    const path = url.pathname;

    // Defesas contra CSRF/DNS rebinding: nada disso substitui o bind em
    // 127.0.0.1, mas o bind sozinho não protege do navegador do usuário.
    const port = server.address()?.port ?? cfg.uiPort;

    if (!isAllowedHost(req.headers.host, port)) {
      return sendJson(res, 403, { error: 'Cabeçalho Host não permitido.' });
    }

    const origin = req.headers.origin;
    if (origin && !isSameOriginHeader(origin, port)) {
      return sendJson(res, 403, { error: 'Origem não permitida.' });
    }

    const asset = STATIC_FILES[path];
    if (asset && req.method === 'GET') {
      const [file, type] = asset;
      let content;
      try {
        content = readFileSync(join(PUBLIC_DIR, file));
      } catch (err) {
        error(`Não foi possível ler o estático ${file}: ${err.message}`);
        return sendJson(res, 500, { error: 'Erro ao carregar a página.' });
      }
      res.writeHead(200, { 'Content-Type': type });
      return res.end(content);
    }

    if (MUTATING_METHODS.includes(req.method) && !hasJsonContentType(req)) {
      return sendJson(res, 415, { error: 'Content-Type deve ser application/json.' });
    }

    // Rota exata devolve a função crua; a dinâmica devolve { fn, params }.
    // Normaliza as duas para a mesma forma antes de chamar.
    let handler;
    try {
      const exactFn = matchExact(routes, req.method, path);
      handler = exactFn ? { fn: exactFn, params: {} } : matchDynamic(routes, req.method, path);
    } catch (err) {
      return sendJson(res, err.status ?? 400, { error: err.message });
    }

    if (!handler) {
      return sendJson(res, 404, { error: `Rota não encontrada: ${req.method} ${path}` });
    }

    if (Object.values(handler.params).some(isInvalidParam)) {
      return sendJson(res, 400, { error: 'Parâmetro de rota inválido.' });
    }

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, bodyLimitFor(path)) : {};
      const result = await handler.fn({ body, params: handler.params, url, schedulesPath, cfg });
      // Resposta binária (o arquivo de um anexo): bytes crus com o tipo dele.
      if (result.raw !== undefined) {
        res.writeHead(result.status ?? 200, {
          'Content-Type': result.contentType ?? 'application/octet-stream',
          'Content-Length': result.raw.length,
          ...(result.headers ?? {}),
        });
        return res.end(result.raw);
      }
      return sendJson(res, result.status ?? 200, result.body);
    } catch (err) {
      const detail = describeError(err);
      error(`Erro ao processar ${req.method} ${path}: ${detail}`);
      const status = err?.status ?? 500;
      if (status === 413) {
        return sendJsonAndClose(req, res, status, { error: detail });
      }
      const message = status >= 500 && !DELIBERATE_5XX.has(status) ? 'Erro interno do servidor.' : detail;
      return sendJson(res, status, { error: message });
    }
  });

  return server;
}

// Casa a rota exata; ignora chaves com ':' (são padrões da busca dinâmica —
// se o caminho pedido for literalmente "/api/messages/:id", não pode achar
// essa entrada por coincidência de string).
function matchExact(routes, method, path) {
  const key = `${method} ${path}`;
  if (key.includes(':')) return null;
  return routes[key] ?? null;
}

// Casa rotas com um parâmetro, ex.: "DELETE /api/messages/:id".
function matchDynamic(routes, method, path) {
  const pathParts = path.split('/');

  for (const [key, fn] of Object.entries(routes)) {
    const [routeMethod, pattern] = key.split(' ');
    if (routeMethod !== method || !pattern.includes(':')) continue;

    const patternParts = pattern.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternParts.length; i += 1) {
      const part = patternParts[i];
      if (part.startsWith(':')) {
        try {
          params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        } catch {
          const err = new Error('URL malformada.');
          err.status = 400;
          throw err;
        }
      } else if (part !== pathParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) return { fn, params };
  }
  return null;
}

/**
 * Cria e inicia o servidor da UI.
 * @param {{schedulesPath?: string, cfg?: object, routes?: object}} [options]
 * @returns {Promise<{server: import('node:http').Server, port: number}>}
 */
export function startUi(options = {}) {
  const cfg = options.cfg ?? config;
  const server = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Host sempre fixo em 127.0.0.1, nunca vindo de env ou cfg: é essa
    // inalcançabilidade de fora que dispensa autenticação própria na tela.
    server.listen(cfg.uiPort, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// Executado apenas quando este arquivo é o entrypoint. O erro mais provável
// aqui é a porta ocupada — sem tratamento, o usuário levava um stack trace
// cru em inglês na cara, enquanto src/index.js já explica o problema em
// português. Mesma postura nos dois processos.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { server, port } = await startUi();
    info(`Tela de agendamentos em http://${server.address().address}:${port}`);
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      error(
        `A porta ${config.uiPort} já está em uso: outra tela rodando, ou outro serviço ocupando ` +
          'a porta (o WAHA, por exemplo, escuta em 3000 por padrão).'
      );
      error('Encerre quem está usando a porta ou defina outra em UI_PORT no .env.');
    } else if (err?.code === 'EACCES') {
      error(`Sem permissão para escutar na porta ${config.uiPort}. Use uma porta acima de 1024 em UI_PORT.`);
    } else {
      error(`Não foi possível iniciar a tela de agendamentos: ${describeError(err)}`);
    }
    process.exit(1);
  }
}
