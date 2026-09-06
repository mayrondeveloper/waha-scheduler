// Envio de uma mensagem para vários grupos, com intervalo aleatório e log por tentativa.

import { config } from './config.js';
import { appendSendLog, info, error as logError } from './logger.js';
import * as wahaClient from './waha/client.js';

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

/**
 * Envia a mesma mensagem para vários grupos, seguindo em frente quando um falha.
 * @param {string} message Texto a enviar.
 * @param {string[]} groups Ids dos grupos de destino.
 * @param {{client?: {sendText: Function}, cfg?: object, label?: string}} [options]
 *   client: implementação injetável do WAHA (default: cliente real).
 * @returns {Promise<{sent: number, failed: number, results: Array<{chatId: string, status: 'sent'|'error', error?: string}>}>}
 */
export async function broadcast(message, groups, options = {}) {
  const { client = wahaClient, cfg = config, label = null } = options;

  const text = String(message ?? '').trim();
  if (!text) {
    throw new Error('Mensagem vazia: informe um texto para enviar.');
  }

  const targets = normalizeGroups(groups);
  if (targets.length === 0) {
    throw new Error('Nenhum grupo de destino informado.');
  }

  const results = [];

  for (const [index, chatId] of targets.entries()) {
    try {
      await client.sendText(chatId, text, cfg);
      results.push({ chatId, status: 'sent' });
      appendSendLog({ status: 'sent', chatId, message: text, label }, cfg.logPath);
      info(`Enviado para ${chatId}`);
    } catch (err) {
      results.push({ chatId, status: 'error', error: err.message });
      appendSendLog({ status: 'error', chatId, message: text, label, error: err.message }, cfg.logPath);
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
