// Configuração central da aplicação: lê variáveis de ambiente e aplica defaults.

import 'dotenv/config';

const DEFAULTS = {
  WAHA_URL: 'http://localhost:3000',
  WAHA_SESSION: 'default',
  WAHA_API_KEY: '',
  SCHEDULES_PATH: './data/schedules.json',
  LOG_PATH: './logs/sends.jsonl',
  DELAY_MIN_MS: '3000',
  DELAY_MAX_MS: '8000',
  TIMEZONE: 'America/Sao_Paulo',
  UI_PORT: '3010',
  CLICKS_URL: '',
  CLICKS_API_KEY: '',
};

/**
 * Confirma que o valor é um fuso IANA reconhecido.
 * @param {string} timezone Fuso a validar, ex.: "America/Sao_Paulo".
 */
export function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(
      `Fuso horário inválido: "${timezone}". Use um identificador IANA como ` +
        'America/Sao_Paulo (veja TIMEZONE no .env).'
    );
  }
}

function readTimezone(env, key) {
  // Valor em branco no .env significa "não configurei", não "fuso vazio".
  const raw = (env[key] ?? '').trim() || DEFAULTS[key];
  try {
    assertTimezone(raw);
  } catch {
    throw new Error(
      `Variável ${key} inválida: "${raw}". Use um identificador IANA como America/Sao_Paulo.`
    );
  }
  return raw;
}

function readNumber(env, key) {
  const raw = env[key] ?? DEFAULTS[key];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Variável ${key} inválida: "${raw}". Use um número maior ou igual a zero.`);
  }
  return value;
}

/**
 * Monta o objeto de configuração a partir de um mapa de variáveis de ambiente.
 * @param {Record<string, string|undefined>} [env] Fonte das variáveis (default: process.env).
 * @returns {{wahaUrl: string, session: string, apiKey: string, schedulesPath: string,
 *            logPath: string, delayMinMs: number, delayMaxMs: number, timezone: string,
 *            uiPort: number}}
 */
export function loadConfig(env = process.env) {
  const delayMinMs = readNumber(env, 'DELAY_MIN_MS');
  const delayMaxMs = readNumber(env, 'DELAY_MAX_MS');

  if (delayMaxMs < delayMinMs) {
    throw new Error(
      `DELAY_MAX_MS (${delayMaxMs}) não pode ser menor que DELAY_MIN_MS (${delayMinMs}).`
    );
  }

  return Object.freeze({
    wahaUrl: (env.WAHA_URL ?? DEFAULTS.WAHA_URL).replace(/\/+$/, ''),
    session: env.WAHA_SESSION ?? DEFAULTS.WAHA_SESSION,
    apiKey: env.WAHA_API_KEY ?? DEFAULTS.WAHA_API_KEY,
    schedulesPath: env.SCHEDULES_PATH ?? DEFAULTS.SCHEDULES_PATH,
    logPath: env.LOG_PATH ?? DEFAULTS.LOG_PATH,
    delayMinMs,
    delayMaxMs,
    timezone: readTimezone(env, 'TIMEZONE'),
    uiPort: readNumber(env, 'UI_PORT'),
    // Cliques por disparo: as duas vazias desligam a função.
    clicksUrl: (env.CLICKS_URL ?? DEFAULTS.CLICKS_URL).trim().replace(/\/+$/, ''),
    clicksApiKey: (env.CLICKS_API_KEY ?? DEFAULTS.CLICKS_API_KEY).trim(),
  });
}

export const config = loadConfig();
