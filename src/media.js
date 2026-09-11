// Anexos das mensagens: tipos aceitos, gravação em data/media e leitura para o envio.

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Teto do WhatsApp para imagem, vídeo e áudio. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Tipos de anexo, na ordem em que a tela os oferece. */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'document'];

// Só o que o WhatsApp mostra como foto. GIF fica de fora de propósito: o
// WhatsApp o trata como vídeo e a engine WEBJS não converte — vai como arquivo.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Classifica o anexo pelo mimetype; é o que decide o endpoint do WAHA.
 * @param {string} mimetype
 * @returns {'image'|'video'|'audio'|'document'}
 */
export function classifyMedia(mimetype) {
  const type = String(mimetype).trim().toLowerCase();
  if (IMAGE_TYPES.has(type)) return 'image';
  if (type === 'video/mp4') return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Extensão do arquivo em disco, derivada do nome original: só letras e
 * números, até 8 caracteres, minúscula. Sem extensão válida, "bin". O nome
 * original nunca vira caminho.
 * @param {string} filename
 * @returns {string}
 */
export function safeExtension(filename) {
  const base = String(filename).split(/[\\/]/).pop() ?? '';
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(base);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * Pasta dos anexos: "media", ao lado do arquivo de agendamentos.
 * @param {string} schedulesPath
 * @returns {string}
 */
export function mediaDirFor(schedulesPath) {
  return join(dirname(schedulesPath), 'media');
}

/**
 * Caminho do arquivo de um anexo.
 * @param {string} dir Pasta dos anexos.
 * @param {{id: string, filename: string}} media
 * @returns {string}
 */
export function mediaPath(dir, media) {
  if (!/^[\w-]+$/.test(String(media.id))) {
    throw new Error(`Anexo com id inválido: "${media.id}".`);
  }
  return join(dir, `${media.id}.${safeExtension(media.filename)}`);
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/**
 * Valida o anexo recebido em base64 e o grava em disco.
 * @param {string} dir Pasta dos anexos (criada se não existir).
 * @param {{filename: string, mimetype: string, data: string}} input data em base64.
 * @param {{maxBytes?: number}} [options]
 * @returns {{id: string, filename: string, mimetype: string, size: number, kind: string}}
 */
export function saveMedia(dir, input, { maxBytes = MAX_MEDIA_BYTES } = {}) {
  const filename = typeof input?.filename === 'string' ? input.filename.trim() : '';
  if (!filename) throw new Error('Anexo sem nome de arquivo.');

  const mimetype = typeof input.mimetype === 'string' ? input.mimetype.trim().toLowerCase() : '';
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimetype)) {
    throw new Error(`Anexo "${filename}": mimetype inválido "${input.mimetype}".`);
  }

  const data = typeof input.data === 'string' ? input.data.replace(/\s+/g, '') : '';
  if (!data) throw new Error(`Anexo "${filename}": conteúdo vazio.`);
  if (!BASE64.test(data) || data.length % 4 !== 0) {
    throw new Error(`Anexo "${filename}": conteúdo não é base64 válido.`);
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes) {
    throw new Error(`Anexo "${filename}" tem ${formatBytes(bytes.length)} e passa do limite de ${formatBytes(maxBytes)}.`);
  }

  const media = {
    id: `med-${randomUUID().slice(0, 8)}`,
    filename,
    mimetype,
    size: bytes.length,
    kind: classifyMedia(mimetype),
  };
  const path = mediaPath(dir, media);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, bytes);
  } catch (err) {
    throw new Error(`Não foi possível gravar o anexo em ${path}: ${err.message}`);
  }
  return media;
}

/**
 * Apaga o arquivo do anexo; já ausente não é erro.
 * @param {string} dir
 * @param {{id: string, filename: string}} media
 */
export function removeMedia(dir, media) {
  try {
    unlinkSync(mediaPath(dir, media));
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new Error(`Não foi possível apagar o anexo "${media.filename}": ${err.message}`);
  }
}

/**
 * Lê o arquivo do anexo em base64, como o WAHA recebe.
 * @param {string} dir
 * @param {{id: string, filename: string}} media
 * @returns {string}
 */
export function readMediaBase64(dir, media) {
  const path = mediaPath(dir, media);
  try {
    return readFileSync(path).toString('base64');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Anexo não encontrado: ${media.filename} (${path})`);
    throw new Error(`Não foi possível ler o anexo "${media.filename}": ${err.message}`);
  }
}
