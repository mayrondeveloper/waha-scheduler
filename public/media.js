// Anexos na tela: classificação, tamanho por extenso, prévias e validação.
// Espelha as regras de src/media.js para o erro aparecer antes do upload.
// Sem DOM: importável pelos testes.

import { escape, icon } from './html.js';

/** Teto do WhatsApp para imagem, vídeo e áudio; o mesmo do servidor. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const KIND_ICONS = { image: 'image', video: 'film', audio: 'music', document: 'fileText' };

/**
 * Classifica o anexo pelo mimetype, como o servidor faz.
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
 * Tamanho por extenso: "512 bytes", "179 KB", "1,2 MB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * Confere o arquivo escolhido antes de ler o conteúdo.
 * @param {{name: string, size: number}} file
 * @returns {string|null} Mensagem de erro, ou null se o arquivo serve.
 */
export function validateFile(file) {
  if (file.size > MAX_MEDIA_BYTES) {
    return `"${file.name}" tem ${formatBytes(file.size)}; o limite é 16 MB.`;
  }
  return null;
}

function docCard(media) {
  return `
    <div class="media-doc">
      ${icon(KIND_ICONS[media.kind] ?? 'fileText')}
      <span class="media-doc-name">${escape(media.filename)}</span>
      <small>${escape(formatBytes(media.size))}</small>
    </div>`;
}

/**
 * Prévia do anexo no balão, como chega no grupo: imagem ou vídeo em cima da
 * legenda; documento e áudio como cartão.
 * @param {{kind: string, filename: string, size: number}} media
 * @param {string} src URL do arquivo (do servidor ou do próprio navegador).
 * @returns {string}
 */
export function mediaPreview(media, src) {
  if (media.kind === 'image') return `<img class="media-img" src="${escape(src)}" alt="${escape(media.filename)}">`;
  if (media.kind === 'video') return `<video class="media-video" src="${escape(src)}" controls preload="metadata"></video>`;
  if (media.kind === 'audio') {
    return `${docCard(media)}<audio class="media-audio" src="${escape(src)}" controls preload="none"></audio>`;
  }
  return docCard(media);
}

/**
 * Anexo em uma linha, para listas e chips.
 * @param {{kind: string, filename: string}} media
 * @returns {string}
 */
export function mediaChip(media) {
  return `<span class="media-chip">${icon(KIND_ICONS[media.kind] ?? 'fileText')} ${escape(media.filename)}</span>`;
}

/**
 * A tira abaixo do texto do editor: miniatura ou ícone, nome, tamanho e remover.
 * @param {{kind: string, filename: string, size: number}} media
 * @param {string} src
 * @returns {string}
 */
export function mediaStrip(media, src) {
  const thumb = media.kind === 'image'
    ? `<img class="media-thumb" src="${escape(src)}" alt="">`
    : `<span class="media-thumb media-thumb-icon">${icon(KIND_ICONS[media.kind] ?? 'fileText')}</span>`;
  return `
    <div class="media-item">
      ${thumb}
      <span class="media-name">${escape(media.filename)}</span>
      <small class="media-size">${escape(formatBytes(media.size))}</small>
      <button type="button" class="link" data-action="remove-media">Remover</button>
    </div>`;
}
