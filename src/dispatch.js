// Preparação de um disparo: identidade (dispatchId), links rastreáveis por
// grupo e a prévia do destino. Nada aqui impede o envio: sem redirecionador
// ou sem prévia, o texto sai como está e o log diz o que faltou.

import { newId } from './schedules.js';
import { findUrls, requestLinks } from './links.js';
import { fetchOpenGraph } from './preview.js';
import { warn } from './logger.js';

const NAMES_CACHE_MS = 600_000;
let namesCache = { at: 0, byId: new Map() };

/**
 * Cliques ligados: URL e chave do redirecionador configuradas.
 * @param {{clicksUrl?: string, clicksApiKey?: string}} cfg
 * @returns {boolean}
 */
export function clicksEnabled(cfg) {
  return Boolean(cfg?.clicksUrl && cfg?.clicksApiKey);
}

// Nomes dos grupos para o UTM, pelo WAHA, com cache de 10 min. Sem o WAHA
// (ou sem client), o id serve de nome.
async function groupNames(ids, client, cfg, now) {
  if (typeof client?.listGroups !== 'function') return new Map();
  if (now - namesCache.at > NAMES_CACHE_MS || ids.some((id) => !namesCache.byId.has(id))) {
    try {
      const groups = await client.listGroups(cfg);
      namesCache = { at: now, byId: new Map(groups.map((g) => [g.id, g.name])) };
    } catch (err) {
      warn(`Nomes dos grupos indisponíveis para o UTM (${err.message}); os ids serão usados.`);
    }
  }
  return namesCache.byId;
}

/**
 * Prepara o disparo: gera o dispatchId, acha as URLs do texto, pede os links
 * rastreáveis (2 s de limite) e busca a prévia do primeiro link.
 * @param {{schedule: {id: string, name: string, utm?: boolean}, message: string, targets: string[],
 *          cfg: object, client?: {listGroups?: Function}, fetchImpl?: typeof fetch, now?: number}} input
 * @returns {Promise<{dispatchId: string, urls: string[], links: object|null, preview: object|null,
 *            tracking: 'none'|'off'|'ok'|'unavailable', extra: object}>}
 *   extra: os campos que vão em cada linha do log (dispatchId, tracking, links).
 */
export async function prepareDispatch({ schedule, message, targets, cfg, client = null, fetchImpl = fetch, now = Date.now() }) {
  const dispatchId = newId('dsp');
  const urls = findUrls(message);
  const done = (tracking, links, preview) => ({
    dispatchId, urls, links, preview, tracking, extra: { dispatchId, tracking, links: urls.length },
  });

  if (urls.length === 0) return done('none', null, null);

  let links = null;
  let tracking = 'off';
  if (clicksEnabled(cfg)) {
    try {
      const names = await groupNames(targets, client, cfg, now);
      links = await requestLinks({
        dispatchId,
        schedule: { id: schedule.id, name: schedule.name },
        groups: targets.map((id) => ({ id, name: names.get(id) ?? id })),
        urls,
        utm: schedule.utm !== false,
      }, cfg, { fetchImpl });
      tracking = 'ok';
    } catch (err) {
      warn(`Disparo "${schedule.name}" sem medição de cliques: ${err.message}. Os links saem como estão.`);
      tracking = 'unavailable';
    }
  }

  const preview = await fetchOpenGraph(urls[0], { fetchImpl });
  return done(tracking, links, preview);
}

/** Esvazia o cache de nomes (testes). */
export function clearNamesCache() {
  namesCache = { at: 0, byId: new Map() };
}
