// Prévia do destino de um link: título, descrição e imagem das tags Open
// Graph, para o envio com prévia customizada. Cache em memória por 1 h.

const CACHE_MS = 3_600_000;
const cache = new Map();

const META_RE = /<meta\b[^>]*>/gi;
const attr = (tag, name) => {
  const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return found ? (found[2] ?? found[3]) : null;
};
const decode = (value) => String(value ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim();

/**
 * Extrai o Open Graph de um HTML. Sem og:title, não há prévia.
 * @param {string} html
 * @param {string} baseUrl Para resolver uma imagem relativa.
 * @returns {{title: string, description: string, image: string|null}|null}
 */
export function parseOpenGraph(html, baseUrl) {
  const tags = {};
  for (const [tag] of String(html).matchAll(META_RE)) {
    const property = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (!property.startsWith('og:') && property !== 'description') continue;
    const content = attr(tag, 'content');
    if (content != null && !(property in tags)) tags[property] = decode(content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = tags['og:title'] || (titleTag ? decode(titleTag[1]) : '');
  if (!title) return null;
  let image = tags['og:image'] || null;
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = null;
    }
  }
  return { title: title.slice(0, 200), description: (tags['og:description'] || tags.description || '').slice(0, 300), image };
}

/**
 * Busca a prévia de um destino: HTML até 1 MB, 5 s de limite, cache de 1 h.
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number, now?: () => number}} [options]
 * @returns {Promise<{url: string, title: string, description: string, image: string|null}|null>}
 *   null quando o destino não responde, não é HTML ou não tem título.
 */
export async function fetchOpenGraph(url, { fetchImpl = fetch, timeoutMs = 5000, maxBytes = 1_000_000, now = Date.now } = {}) {
  const cached = cache.get(url);
  if (cached && now() - cached.at < CACHE_MS) return cached.preview;

  let preview = null;
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'waha-scheduler/1.0 (+preview)' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    const type = res.headers?.get?.('content-type') ?? '';
    if (res.ok && (!type || /html/i.test(type))) {
      const html = await readUpTo(res, maxBytes);
      const parsed = parseOpenGraph(html, res.url || url);
      if (parsed) preview = { url, ...parsed };
    }
  } catch {
    preview = null;
  }
  cache.set(url, { at: now(), preview });
  return preview;
}

async function readUpTo(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  while (total < maxBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    out += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return out;
}

/** Esvazia o cache (testes). */
export function clearPreviewCache() {
  cache.clear();
}
