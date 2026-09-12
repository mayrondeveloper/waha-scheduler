// Leitura do log de envios (JSONL). O agendador e a tela gravam no mesmo
// arquivo, então ele é a verdade compartilhada para o freio por hora.

import { readFileSync } from 'node:fs';

/** Janela do limite por hora, em ms. */
export const HOUR_MS = 3_600_000;

/**
 * Lê todas as linhas do log. Arquivo ausente é log vazio; uma linha
 * corrompida é descartada sem derrubar a leitura.
 * @param {string} logPath
 * @returns {object[]} Entradas na ordem do arquivo.
 */
export function readSendLog(logPath) {
  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`Não foi possível ler o log de envios em ${logPath}: ${err.message}`);
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // linha pela metade (processo caiu no meio da escrita): ignora
    }
  }
  return entries;
}

/**
 * Instantes (ms) dos envios com sucesso dentro da janela, do mais antigo
 * para o mais novo.
 * @param {string} logPath
 * @param {{windowMs?: number, now?: number}} [options]
 * @returns {number[]}
 */
export function recentSends(logPath, { windowMs = HOUR_MS, now = Date.now() } = {}) {
  const since = now - windowMs;
  return readSendLog(logPath)
    .filter((e) => e.status === 'sent')
    .map((e) => Date.parse(e.ts))
    .filter((ts) => Number.isFinite(ts) && ts >= since && ts <= now)
    .sort((a, b) => a - b);
}

/**
 * Quantos envios com sucesso houve na janela.
 * @param {string} logPath
 * @param {{windowMs?: number, now?: number}} [options]
 * @returns {number}
 */
export function countRecentSends(logPath, options) {
  return recentSends(logPath, options).length;
}
