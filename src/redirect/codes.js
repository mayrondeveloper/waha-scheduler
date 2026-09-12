// Redirecionador: funções puras. Códigos dos links, slugs, UTM, classificação
// de um acesso (humano, prévia ou robô) e os hashes que substituem o
// endereço do visitante (nunca guardado em claro).

import { randomBytes, createHash } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Acessos do próprio remetente até este tempo depois de criar o link são a prévia do WhatsApp, não cliques. */
export const PREVIEW_WINDOW_MS = 60_000;

const BOT_UA = /whatsapp|facebookexternalhit|bot|crawler|spider|preview|curl|wget|python-requests|go-http-client/i;

/**
 * Código aleatório em base62, uniforme (sem viés de módulo).
 * @param {number} [length]
 * @returns {string}
 */
export function newCode(length = 10) {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // 248 = 62 * 4: bytes acima disso quebrariam a uniformidade.
      if (byte < 248 && out.length < length) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

/**
 * Slug para UTM: minúsculas, sem acento, "-" no lugar do que não é [a-z0-9].
 * @param {string} text
 * @returns {string} "sem-nome" quando não sobra nada.
 */
export function slug(text) {
  const s = String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'sem-nome';
}

/**
 * Acrescenta os parâmetros UTM ao destino sem sobrescrever os que já existem.
 * @param {string} url Destino http(s).
 * @param {{campaign: string, content: string}} tags Nome do agendamento e do grupo.
 * @returns {string}
 */
export function withUtm(url, { campaign, content }) {
  const target = new URL(url);
  const params = {
    utm_source: 'whatsapp',
    utm_medium: 'grupo',
    utm_campaign: slug(campaign),
    utm_content: slug(content),
  };
  for (const [key, value] of Object.entries(params)) {
    if (!target.searchParams.has(key)) target.searchParams.set(key, value);
  }
  return target.toString();
}

/**
 * Hash do visitante: sal do dia, endereço e User-Agent. Muda todo dia, então
 * "único" é único por dia.
 * @param {string} salt
 * @param {string} ip
 * @param {string} userAgent
 * @returns {string}
 */
export function visitorHash(salt, ip, userAgent) {
  return createHash('sha256').update(`${salt}|${ip}|${userAgent}`).digest('hex');
}

/**
 * Hash do endereço só, para a regra da prévia do remetente.
 * @param {string} salt
 * @param {string} ip
 * @returns {string}
 */
export function ipHash(salt, ip) {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex');
}

/**
 * Classifica um acesso ao link: só "human" conta como clique.
 * @param {{method: string, userAgent: string, ipHash: string, link: {creator_ip_hash: string, created_at: string}|null, nowMs: number}} access
 * @returns {'human'|'bot'|'preview'}
 */
export function classifyAccess({ method, userAgent, ipHash: visitorIp, link, nowMs }) {
  if (method !== 'GET') return 'bot';
  const ua = String(userAgent ?? '');
  if (!ua || BOT_UA.test(ua)) return 'bot';
  if (link && link.creator_ip_hash && link.creator_ip_hash === visitorIp
    && nowMs - Date.parse(link.created_at) < PREVIEW_WINDOW_MS) {
    return 'preview';
  }
  return 'human';
}
