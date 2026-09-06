// Servidor HTTP local da tela de agendamentos. Escuta apenas em 127.0.0.1.

import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { info, error } from '../logger.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

// Lista fixa: o caminho servido nunca é montado a partir da URL.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Corpo da requisição grande demais.'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Cria o servidor da UI sem iniciá-lo.
 * @param {{schedulesPath?: string, cfg?: object, routes?: object}} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  const { schedulesPath = config.schedulesPath, cfg = config, routes = {} } = options;

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    const asset = STATIC_FILES[path];
    if (asset && req.method === 'GET') {
      const [file, type] = asset;
      try {
        res.writeHead(200, { 'Content-Type': type });
        return res.end(readFileSync(join(PUBLIC_DIR, file)));
      } catch (err) {
        error(`Não foi possível ler o estático ${file}: ${err.message}`);
        return sendJson(res, 500, { error: 'Erro ao carregar a página.' });
      }
    }

    // Rota exata devolve a função crua; a dinâmica devolve { fn, params }.
    // Normaliza as duas para a mesma forma antes de chamar.
    const exact = routes[`${req.method} ${path}`];
    const handler = exact ? { fn: exact, params: {} } : matchDynamic(routes, req.method, path);
    if (!handler) {
      return sendJson(res, 404, { error: `Rota não encontrada: ${req.method} ${path}` });
    }

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await handler.fn({ body, params: handler.params, url, schedulesPath, cfg });
      return sendJson(res, result.status ?? 200, result.body);
    } catch (err) {
      error(err.message);
      return sendJson(res, err.status ?? 500, { error: err.message });
    }
  });
}

// Casa rotas com um parâmetro, ex.: "DELETE /api/messages/:id".
function matchDynamic(routes, method, path) {
  for (const [key, fn] of Object.entries(routes)) {
    const [routeMethod, pattern] = key.split(' ');
    if (routeMethod !== method || !pattern.includes(':')) continue;

    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    const casou = patternParts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        return true;
      }
      return part === pathParts[i];
    });

    if (casou) return { fn, params };
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
    // Sempre 127.0.0.1: a tela dispara envios reais e não pode ser alcançável de fora.
    server.listen(cfg.uiPort, cfg.uiHost ?? '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startUi();
  info(`Tela de agendamentos em http://127.0.0.1:${port}`);
}
