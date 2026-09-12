// Saída de console padronizada e registro de envios em JSONL.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

function timestamp() {
  return new Date().toISOString();
}

function write(stream, level, args) {
  stream.write(`[${timestamp()}] [${level}] ${args.join(' ')}\n`);
}

/**
 * Registra uma mensagem informativa na saída padrão.
 * @param {...unknown} args Partes da mensagem.
 */
export function info(...args) {
  write(process.stdout, 'INFO', args);
}

/**
 * Registra uma mensagem de sucesso na saída padrão.
 * @param {...unknown} args Partes da mensagem.
 */
export function success(...args) {
  write(process.stdout, 'OK', args);
}

/**
 * Registra um aviso na saída de erro.
 * @param {...unknown} args Partes da mensagem.
 */
export function warn(...args) {
  write(process.stderr, 'AVISO', args);
}

/**
 * Registra um erro na saída de erro.
 * @param {...unknown} args Partes da mensagem.
 */
export function error(...args) {
  write(process.stderr, 'ERRO', args);
}

/**
 * Acrescenta uma linha JSON ao log de envios, criando o diretório se necessário.
 * @param {{status: 'sent'|'error'|'skipped', chatId: string, message: string, error?: string,
 *          reason?: string, ts?: string}} entry ts: instante, quando quem grava tem um relógio próprio (freio).
 * @param {string} [logPath] Caminho do arquivo (default: config.logPath).
 */
export function appendSendLog(entry, logPath = config.logPath) {
  const record = { ts: timestamp(), ...entry };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    error(`Não foi possível gravar o log em ${logPath}: ${err.message}`);
  }
}
