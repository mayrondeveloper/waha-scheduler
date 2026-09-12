// Links rastreáveis: acha as URLs do texto, troca pelas curtas e pede os
// códigos ao redirecionador. O envio nunca espera mais de 2 s por ele.

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const TRAILING = /[.,;:!?\]}'"]/;

/** Tempo máximo de espera pelo redirecionador. */
export const LINKS_TIMEOUT_MS = 2000;

const count = (s, ch) => s.split(ch).length - 1;

// Tira a pontuação colada no fim da URL. Um ")" só sai quando não fecha um
// "(" de dentro da própria URL (wikipedia-style "a_(b)").
function trimTrailing(raw) {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last && TRAILING.test(last)) {
      url = url.slice(0, -1);
    } else if (last === ')' && count(url, '(') < count(url, ')')) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/**
 * URLs http(s) do texto, únicas e na ordem, sem a pontuação que costuma
 * vir colada no fim ("veja: https://x.y/p." → "https://x.y/p").
 * @param {string} text
 * @returns {string[]}
 */
export function findUrls(text) {
  const found = [];
  for (const match of String(text ?? '').matchAll(URL_RE)) {
    const url = trimTrailing(match[0]);
    if (url && !found.includes(url)) found.push(url);
  }
  return found;
}

/**
 * Troca cada URL do texto pela correspondente no mapa, sem tocar no resto.
 * URLs fora do mapa ficam como estão.
 * @param {string} text
 * @param {Record<string, string>} map `{ [url]: shortUrl }`
 * @returns {string}
 */
export function rewriteLinks(text, map) {
  if (!map || Object.keys(map).length === 0) return text;
  const urls = Object.keys(map).sort((a, b) => b.length - a.length);
  let out = text;
  for (const url of urls) {
    out = out.split(url).join(map[url]);
  }
  return out;
}

/**
 * Pede ao redirecionador um link curto por (grupo, URL).
 * @param {{dispatchId: string, schedule: {id: string, name: string}, groups: Array<{id: string, name: string}>,
 *          urls: string[], utm: boolean}} input
 * @param {{clicksUrl: string, clicksApiKey: string}} cfg
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<Record<string, Record<string, string>>>} `{ [groupId]: { [url]: shortUrl } }`
 */
export async function requestLinks(input, cfg, { fetchImpl = fetch, timeoutMs = LINKS_TIMEOUT_MS } = {}) {
  const url = `${cfg.clicksUrl}/api/links`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${cfg.clicksApiKey}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? `não respondeu em ${timeoutMs} ms` : err.message;
    throw new Error(`Redirecionador indisponível em ${url}: ${why}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erro ${res.status} do redirecionador em ${url}: ${body.slice(0, 200) || '(corpo vazio)'}`);
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data.links !== 'object') {
    throw new Error(`Resposta inesperada do redirecionador em ${url}: esperava "links".`);
  }
  return data.links;
}

/**
 * Cliques de um ou mais disparos, por disparo e por grupo.
 * @param {string[]} dispatchIds
 * @param {{clicksUrl: string, clicksApiKey: string}} cfg
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<Record<string, {clicks: number, unique: number, groups: object}|null>>}
 *   null para o disparo que o redirecionador não conseguiu responder.
 */
export async function fetchClicks(dispatchIds, cfg, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const result = {};
  await Promise.all(dispatchIds.map(async (id) => {
    const url = `${cfg.clicksUrl}/api/dispatches/${encodeURIComponent(id)}/clicks`;
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${cfg.clicksApiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      result[id] = res.ok ? await res.json() : null;
    } catch {
      result[id] = null;
    }
  }));
  return result;
}
