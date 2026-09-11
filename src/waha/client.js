// Cliente HTTP da API WAHA. Único ponto do projeto que fala com a rede.

import { config } from '../config.js';

function headers(cfg) {
  const base = { 'Content-Type': 'application/json', Accept: 'application/json' };
  return cfg.apiKey ? { ...base, 'X-Api-Key': cfg.apiKey } : base;
}

async function readBody(res) {
  const text = (await res.text().catch(() => '')).trim();
  if (!text) return '(corpo vazio)';
  // Um HTML aqui costuma significar WAHA_URL apontando para outro serviço.
  if (text.startsWith('<')) {
    return '(resposta HTML, não JSON — confira se WAHA_URL aponta para o WAHA)';
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Extrai o id textual de um grupo, aceitando string ou objeto { _serialized }.
 * @param {unknown} rawId Valor bruto do campo id retornado pelo WAHA.
 * @returns {string|null} Id no formato "<numero>@g.us" ou null se irreconhecível.
 */
export function extractGroupId(rawId) {
  if (typeof rawId === 'string') return rawId;
  if (rawId && typeof rawId === 'object' && typeof rawId._serialized === 'string') {
    return rawId._serialized;
  }
  return null;
}

/**
 * Normaliza um grupo cru do WAHA para o formato { id, name }.
 * @param {Record<string, unknown>} raw Grupo como devolvido pela API.
 * @returns {{id: string, name: string}|null} Grupo normalizado ou null se sem id válido.
 */
export function normalizeGroup(raw) {
  const id = extractGroupId(raw?.id);
  if (!id) return null;
  const name = raw.name ?? raw.subject ?? '(sem nome)';
  return { id, name: String(name) };
}

/**
 * Lista os grupos da sessão, já normalizados e sem entradas inválidas.
 * @param {object} [cfg] Configuração a usar (default: config global).
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listGroups(cfg = config) {
  const url = `${cfg.wahaUrl}/api/${encodeURIComponent(cfg.session)}/groups`;

  let res;
  try {
    res = await fetch(url, { headers: headers(cfg) });
  } catch (err) {
    throw new Error(`Falha de conexão ao listar grupos em ${url}: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Erro ${res.status} ao listar grupos em ${url}: ${await readBody(res)}`);
  }

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new Error(`Resposta inesperada ao listar grupos em ${url}: esperava uma lista.`);
  }

  return data.map(normalizeGroup).filter(Boolean);
}

/**
 * Envia uma mensagem de texto para um chat.
 * @param {string} chatId Id do destino, ex.: "123456789@g.us".
 * @param {string} text Conteúdo da mensagem.
 * @param {object} [cfg] Configuração a usar (default: config global).
 * @returns {Promise<unknown>} Corpo da resposta do WAHA.
 */
export async function sendText(chatId, text, cfg = config) {
  const url = `${cfg.wahaUrl}/api/sendText`;
  const payload = { session: cfg.session, chatId, text };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Falha de conexão ao enviar para ${chatId}: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Erro ${res.status} ao enviar para ${chatId}: ${await readBody(res)}`);
  }

  return res.json().catch(() => ({}));
}

// Áudio vai por sendFile de propósito: sendVoice exige OPUS em OGG e uma
// conversão dentro do WAHA; como arquivo de áudio, chega tocável no grupo.
const MEDIA_ENDPOINTS = { image: 'sendImage', video: 'sendVideo', audio: 'sendFile', document: 'sendFile' };

/**
 * Envia um anexo (imagem, vídeo, áudio ou arquivo) para um chat, em base64.
 * @param {string} chatId Id do destino.
 * @param {{mimetype: string, filename: string, data: string}} file data em base64.
 * @param {{kind: 'image'|'video'|'audio'|'document', caption?: string}} [options]
 *   kind decide o endpoint; caption é a legenda (só vai quando não é vazia).
 * @param {object} [cfg] Configuração a usar (default: config global).
 * @returns {Promise<unknown>} Corpo da resposta do WAHA.
 */
export async function sendMedia(chatId, file, { kind, caption } = {}, cfg = config) {
  const url = `${cfg.wahaUrl}/api/${MEDIA_ENDPOINTS[kind] ?? 'sendFile'}`;
  const payload = {
    session: cfg.session,
    chatId,
    file: { mimetype: file.mimetype, filename: file.filename, data: file.data },
  };
  if (caption) payload.caption = caption;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Falha de conexão ao enviar anexo para ${chatId}: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Erro ${res.status} ao enviar anexo para ${chatId}: ${await readBody(res)}`);
  }

  return res.json().catch(() => ({}));
}
