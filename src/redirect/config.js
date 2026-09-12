// Configuração do redirecionador, separada da do agendador: é outro processo,
// com outra porta e outro banco.

import 'dotenv/config';

const DEFAULT_PORT = 3030;

/**
 * Monta a configuração do redirecionador a partir das variáveis de ambiente.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{port: number, dbPath: string, publicUrl: string}}
 */
export function loadRedirectConfig(env = process.env) {
  const port = Number(env.REDIRECT_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Variável REDIRECT_PORT inválida: "${env.REDIRECT_PORT}". Use uma porta de 0 a 65535.`);
  }
  const publicUrl = (env.REDIRECT_PUBLIC_URL ?? `http://127.0.0.1:${port}`).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(publicUrl)) {
    throw new Error(`Variável REDIRECT_PUBLIC_URL inválida: "${env.REDIRECT_PUBLIC_URL}". Use a URL pública do redirecionador, com http ou https.`);
  }
  return Object.freeze({
    port,
    dbPath: env.REDIRECT_DB ?? './data/clicks.sqlite',
    publicUrl,
  });
}
