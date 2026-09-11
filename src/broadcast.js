// Envio de uma mensagem para vários grupos, com intervalo aleatório e log por tentativa.

import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { appendSendLog, info, error as logError } from './logger.js';
import * as wahaClient from './waha/client.js';

// Limite de legenda do WhatsApp. Acima disso, o anexo vai sem legenda e o
// texto segue em mensagem separada.
const CAPTION_MAX = 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * @param {string} message Texto a enviar.
 * @param {string[]} groups Ids dos grupos de destino.
 * @param {{client?: {sendText: Function, sendMedia?: Function}, cfg?: object, label?: string,
 *          media?: {kind: string, filename: string, mimetype: string, path: string}|null}} [options]
 *   client: implementação injetável do WAHA (default: cliente real).
 *   media: anexo com o caminho do arquivo; o texto vira legenda quando cabe.
 * @returns {Promise<{sent: number, failed: number, results: Array<{chatId: string, status: 'sent'|'error', error?: string}>}>}
 */
export async function broadcast(message, groups, options = {}) {
  const { client = wahaClient, cfg = config, label = null, media = null } = options;

  const text = String(message ?? '').trim();
  if (!text) {
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
    try {
      if (file) await sendWithMedia(client, chatId, text, file, media, cfg);
      else await client.sendText(chatId, text, cfg);
      results.push({ chatId, status: 'sent' });
      appendSendLog({ status: 'sent', chatId, message: text, label, ...logMedia }, cfg.logPath);
      info(`Enviado para ${chatId}`);
    } catch (err) {
      results.push({ chatId, status: 'error', error: err.message });
      appendSendLog({ status: 'error', chatId, message: text, label, ...logMedia, error: err.message }, cfg.logPath);
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
