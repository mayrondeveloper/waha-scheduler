// Envio de uma mensagem para vários grupos, com intervalo aleatório e log por tentativa.

import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { appendSendLog, info, error as logError } from './logger.js';
import * as wahaClient from './waha/client.js';
import { recentSends, HOUR_MS } from './send-log.js';
import { spin } from '../public/spintax.js';
import { rewriteLinks } from './links.js';

// Limite de legenda do WhatsApp. Acima disso, o anexo vai sem legenda e o
// texto segue em mensagem separada.
const CAPTION_MAX = 1024;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Freio por hora: com o limite atingido na última hora (contando o que o
// agendador e a tela já mandaram), espera até o envio mais antigo da janela
// sair dela. É um freio, não uma fila: o disparo fica em pé e continua.
async function throttle(chatId, { hourlyLimit, logPath, now, sleep }) {
  let waitedMs = 0;
  if (!hourlyLimit) return waitedMs;
  for (;;) {
    const recent = recentSends(logPath, { windowMs: HOUR_MS, now: now() });
    if (recent.length < hourlyLimit) return waitedMs;
    const waitMs = Math.max(1000, recent[0] + HOUR_MS - now() + 1000);
    info(`Limite de ${hourlyLimit} envios por hora atingido: esperando ${Math.ceil(waitMs / 1000)} s antes de enviar para ${chatId}.`);
    await sleep(waitMs);
    waitedMs += waitMs;
  }
}

function randomDelay(cfg) {
  const span = cfg.delayMaxMs - cfg.delayMinMs;
  return cfg.delayMinMs + Math.floor(Math.random() * (span + 1));
}

/**
 * Normaliza a lista de destinos: remove espaços, vazios e duplicatas.
 * @param {string[]} groups Ids de grupo.
 * @returns {string[]} Ids limpos, na ordem original.
 */
export function normalizeGroups(groups) {
  const seen = new Set();
  const result = [];
  for (const raw of groups ?? []) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

// Lê o anexo uma vez, antes do laço: um arquivo ausente interrompe o disparo
// inteiro, em vez de falhar grupo a grupo com o mesmo motivo.
function loadMediaFile(media) {
  let bytes;
  try {
    bytes = readFileSync(media.path);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Anexo não encontrado: ${media.filename} (${media.path})`);
    throw new Error(`Não foi possível ler o anexo "${media.filename}": ${err.message}`);
  }
  return { mimetype: media.mimetype, filename: media.filename, data: bytes.toString('base64') };
}

// Texto com prévia customizada do destino. Se o endpoint falhar, o texto sai
// simples, uma tentativa só de cada: o envio nunca depende da prévia.
async function sendWithPreview(client, chatId, text, preview, cfg) {
  if (typeof client.sendTextWithPreview !== 'function') {
    await client.sendText(chatId, text, cfg);
    return 'failed';
  }
  try {
    await client.sendTextWithPreview(chatId, text, preview, cfg);
    return 'sent';
  } catch (err) {
    logError(`Prévia falhou para ${chatId}, enviando o texto simples: ${err.message}`);
    await client.sendText(chatId, text, cfg);
    return 'failed';
  }
}

// Legenda quando o WhatsApp aceita: nunca em áudio, e só até o limite. Senão,
// anexo primeiro e texto logo depois, sem intervalo entre os dois.
async function sendWithMedia(client, chatId, text, file, media, cfg) {
  const captionable = media.kind !== 'audio' && text.length <= CAPTION_MAX;
  if (captionable) {
    await client.sendMedia(chatId, file, { kind: media.kind, caption: text }, cfg);
    return;
  }
  await client.sendMedia(chatId, file, { kind: media.kind }, cfg);
  try {
    await client.sendText(chatId, text, cfg);
  } catch (err) {
    throw new Error(`Anexo enviado, mas o texto falhou: ${err.message}`);
  }
}

/**
 * Envia a mesma mensagem para vários grupos, seguindo em frente quando um falha.
 * Cada grupo recebe uma variação sorteada do spintax; o texto que saiu vai
 * no log.
 * @param {string} message Texto a enviar (pode ter spintax).
 * @param {string[]} groups Ids dos grupos de destino.
 * @param {{client?: {sendText: Function, sendMedia?: Function}, cfg?: object, label?: string,
 *          media?: {kind: string, filename: string, mimetype: string, path: string}|null,
 *          hourlyLimit?: number, extra?: object, links?: object|null, preview?: object|null,
 *          random?: () => number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [options]
 *   client: implementação injetável do WAHA (default: cliente real).
 *   media: anexo com o caminho do arquivo; o texto vira legenda quando cabe.
 *   hourlyLimit: freio por hora (0 desliga); extra: campos a mais em cada
 *   linha do log (ex.: deferredFrom); links: `{ [chatId]: { [url]: shortUrl } }`
 *   para trocar os links por grupo; preview: `{ url, title, description, image }`
 *   do destino, usado só sem anexo; random/now/sleep: injetáveis nos testes.
 * @returns {Promise<{sent: number, failed: number, results: Array<{chatId: string, status: 'sent'|'error', error?: string}>}>}
 */
export async function broadcast(message, groups, options = {}) {
  const {
    client = wahaClient, cfg = config, label = null, media = null, hourlyLimit = 0, extra = {},
    links = null, preview = null, random = Math.random, now = Date.now, sleep = defaultSleep,
  } = options;

  const source = String(message ?? '').trim();
  if (!source) {
    throw new Error('Mensagem vazia: informe um texto para enviar.');
  }

  const targets = normalizeGroups(groups);
  if (targets.length === 0) {
    throw new Error('Nenhum grupo de destino informado.');
  }

  const file = media ? loadMediaFile(media) : null;
  const logMedia = media ? { media: { kind: media.kind, filename: media.filename } } : {};
  const results = [];

  for (const [index, chatId] of targets.entries()) {
    // Variação sorteada e links rastreáveis deste grupo.
    const map = links?.[chatId] ?? null;
    const text = rewriteLinks(spin(source, random), map);
    const waitedMs = await throttle(chatId, { hourlyLimit, logPath: cfg.logPath, now, sleep });
    // O instante vem do mesmo relógio do freio: é ele que a próxima contagem lê.
    const logExtra = { ts: new Date(now()).toISOString(), ...extra, ...(waitedMs > 0 && { waitedMs }) };
    try {
      let previewState = null;
      if (file) {
        await sendWithMedia(client, chatId, text, file, media, cfg);
      } else if (preview) {
        // A prévia mostra o link como está no texto deste grupo (o curto, se houver).
        previewState = await sendWithPreview(client, chatId, text, { ...preview, url: map?.[preview.url] ?? preview.url }, cfg);
      } else {
        await client.sendText(chatId, text, cfg);
      }
      results.push({ chatId, status: 'sent' });
      appendSendLog({
        status: 'sent', chatId, message: text, label, ...logMedia, ...logExtra, ...(previewState && { preview: previewState }),
      }, cfg.logPath);
      info(`Enviado para ${chatId}`);
    } catch (err) {
      results.push({ chatId, status: 'error', error: err.message });
      appendSendLog({ status: 'error', chatId, message: text, label, ...logMedia, ...logExtra, error: err.message }, cfg.logPath);
      logError(err.message);
    }

    if (index < targets.length - 1) {
      await sleep(randomDelay(cfg));
    }
  }

  return {
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'error').length,
    results,
  };
}
