// Arquivo de status do agendador: é por ele que a tela sabe se os envios vão
// sair. O agendador grava; a tela só lê. Os dois processos continuam separados.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Intervalo entre dois sinais de vida do agendador, em milissegundos. */
export const HEARTBEAT_MS = 15_000;

/** Sem sinal há mais que isto, a tela considera que o agendador parou de responder. */
export const STALE_AFTER_MS = 45_000;

/**
 * Caminho do arquivo de status: a mesma pasta do arquivo de agendamentos.
 * @param {string} schedulesPath Caminho do arquivo de agendamentos.
 * @returns {string}
 */
export function statusPathFor(schedulesPath) {
  return join(dirname(schedulesPath), 'scheduler-status.json');
}

/**
 * Grava o status de forma atômica (arquivo temporário + rename): a tela
 * nunca lê um arquivo pela metade.
 * @param {string} path Caminho do arquivo de status.
 * @param {{pid: number, startedAt: string, beatAt: string, active: string[], reloadError: string|null}} status
 */
export function writeStatus(path, status) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw new Error(`Não foi possível gravar o status do agendador em ${path}: ${err.message}`);
  }
}

/**
 * Lê o status gravado pelo agendador.
 * @param {string} path Caminho do arquivo de status.
 * @returns {object|null} null quando o arquivo não existe (agendador parado).
 */
export function readStatus(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Não foi possível ler o status do agendador em ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Status do agendador inválido em ${path}: ${err.message}`);
  }
}

/**
 * Apaga o arquivo de status, se existir.
 * @param {string} path Caminho do arquivo de status.
 */
export function removeStatus(path) {
  try {
    unlinkSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new Error(`Não foi possível apagar o status do agendador em ${path}: ${err.message}`);
  }
}

/**
 * Estado do agendador a partir do status gravado.
 * @param {object|null} status Retorno de readStatus.
 * @param {number} [now] Instante de referência, em ms.
 * @returns {'running'|'unresponsive'|'stopped'}
 */
export function schedulerState(status, now = Date.now()) {
  if (!status) return 'stopped';
  const beatAt = Date.parse(status.beatAt);
  if (!Number.isFinite(beatAt) || now - beatAt > STALE_AFTER_MS) return 'unresponsive';
  return 'running';
}
