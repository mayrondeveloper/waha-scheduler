// Aba de histórico: envios agrupados por disparo, com filtros. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhen, formatTime } from './dates.js';

/**
 * Subtítulo do cabeçalho da aba: "5 disparos · 1 com falha".
 * @param {object[]} dispatches Saída de groupDispatches.
 * @returns {string}
 */
export function historySubtitle(dispatches) {
  const n = dispatches.length;
  if (n === 0) return 'Nenhum disparo';
  const failed = dispatches.filter((d) => d.failed > 0).length;
  const base = n === 1 ? '1 disparo' : `${n} disparos`;
  return failed > 0 ? `${base} · ${failed} com falha` : base;
}

const SKIP_REASONS = { paused: 'envios pausados' };

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Texto dos cliques de um disparo: "47 cliques (31 únicos)", ou por que não
 * há número. '' para linhas antigas, sem os campos.
 * @param {{dispatchId: string|null, tracking: string|null, links: number|null}} d
 * @param {Record<string, {clicks: number, unique: number}|null|undefined>} clicks Por dispatchId.
 * @returns {string}
 */
export function clicksText(d, clicks = {}) {
  if (d.links === 0) return 'sem link';
  if (d.tracking === 'off') return 'cliques desligados';
  if (d.tracking === 'unavailable') return 'não medido';
  if (d.tracking !== 'ok' || !d.dispatchId) return '';
  const data = clicks[d.dispatchId];
  if (data === undefined) return 'cliques…';
  if (data === null) return 'cliques indisponíveis';
  return `${plural(data.clicks, 'clique', 'cliques')} (${data.unique} ${data.unique === 1 ? 'único' : 'únicos'})`;
}

function entryText(e, groupName, groupClicks) {
  const name = escape(groupName(e.chatId));
  if (e.status === 'error') return `${name}: ${escape(e.error ?? 'falha sem detalhe')}`;
  if (e.status === 'skipped') return `${name}: pulado, ${escape(SKIP_REASONS[e.reason] ?? e.reason ?? 'sem motivo')}`;
  const waited = e.waitedMs > 0 ? ` · esperou ${minutes(e.waitedMs)} min pelo limite por hora` : '';
  const clicked = groupClicks ? ` · ${plural(groupClicks.clicks, 'clique', 'cliques')} (${groupClicks.unique} ${groupClicks.unique === 1 ? 'único' : 'únicos'})` : '';
  return `${name}${waited}${clicked}`;
}

function countText(d, total) {
  if (d.skipped === total) return `${total} ${total === 1 ? 'pulado' : 'pulados'}`;
  return `${d.sent}/${total} enviados`;
}

function dispatchItem(d, { groupName, timeZone, now, clicks }) {
  const total = d.entries.length;
  const groups = [...new Set(d.entries.map((e) => groupName(e.chatId)))].join(' · ');
  const entryIcon = (e) => (e.status === 'error' ? 'x' : e.status === 'skipped' ? 'clock' : 'check');
  const perGroup = clicks?.[d.dispatchId]?.groups ?? {};
  const entries = d.entries.map((e) => `
    <li class="${e.status === 'error' ? 'text-danger' : e.status === 'skipped' ? 'is-skipped' : ''}">
      ${icon(entryIcon(e))}
      <span>${entryText(e, groupName, e.status === 'sent' ? perGroup[e.chatId] : null)}</span>
      <span class="entry-time">${escape(formatTime(e.ts, { timeZone, seconds: true }))}</span>
    </li>`).join('');
  const clicksLabel = clicksText(d, clicks);
  const clicksHtml = clicksLabel ? `<span class="clicks">${escape(clicksLabel)}</span>` : '';
  const deferredNote = d.deferredFrom
    ? `<li class="dispatch-note">${icon('clock')}<span>Adiado pela janela de silêncio (era ${escape(formatWhen(d.deferredFrom, { timeZone, now }))})</span></li>`
    : '';
  const allSkipped = d.skipped > 0 && d.skipped === total;
  const tone = d.failed ? 'tone-danger' : allSkipped ? 'tone-neutral' : 'tone-ok';
  const summaryIcon = d.failed ? 'alert' : allSkipped ? 'clock' : 'circleCheck';

  return `
    <li>
      <details class="dispatch${d.failed ? ' has-failure' : ''}"${d.failed ? ' open' : ''}>
        <summary class="row dispatch-row">
          <span class="dispatch-icon ${tone}">${icon(summaryIcon)}</span>
          <span class="row-main">
            <span class="row-title-text">${escape(d.name)}</span>${d.manual ? '<span class="tag">manual</span>' : ''}${d.deferredFrom ? '<span class="tag">adiado</span>' : ''}${allSkipped ? '<span class="tag">pulado</span>' : ''}
            <span class="dispatch-groups">${escape(groups)}</span>
          </span>
          <span class="dispatch-when">${escape(formatWhen(d.startedAt, { timeZone, now }))}</span>
          ${clicksHtml}
          <span class="dispatch-count${d.failed ? ' is-failed' : ''}">${countText(d, total)}</span>
          <span class="chevron">${icon('chevronDown')}</span>
        </summary>
        <ul class="dispatch-entries">${deferredNote}${entries}</ul>
      </details>
    </li>`;
}

/**
 * HTML do histórico.
 * @param {{dispatches: object[], filter: {name: string, onlyFailed: boolean},
 *          groupName: (id: string) => string, timeZone?: string, now?: number,
 *          clicks?: Record<string, object|null>}} input
 *   dispatches: saída de groupDispatches. clicks: por dispatchId, de GET /api/clicks.
 * @returns {string}
 */
export function historyView({ dispatches, filter, groupName, timeZone, now, clicks = {} }) {
  if (dispatches.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Nenhum envio registrado</p>
        <p>Os envios do agendador e do "Enviar agora" aparecem aqui.</p>
      </div>`;
  }

  const names = [...new Set(dispatches.map((d) => d.name))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const visible = dispatches.filter((d) =>
    (!filter.name || d.name === filter.name) && (!filter.onlyFailed || d.failed > 0));

  const filters = `
    <div class="filters">
      <select data-role="history-name" aria-label="Filtrar por agendamento">
        <option value="">Todos os agendamentos</option>
        ${names.map((n) => `<option value="${escape(n)}" ${n === filter.name ? 'selected' : ''}>${escape(n)}</option>`).join('')}
      </select>
      <div class="segmented" role="group" aria-label="Filtrar por resultado">
        <button type="button" data-action="history-all" aria-pressed="${!filter.onlyFailed}">Todos</button>
        <button type="button" data-action="history-failed" aria-pressed="${filter.onlyFailed}">Com falha</button>
      </div>
      <span class="hint">Últimos 500 envios</span>
    </div>`;

  const list = visible.length === 0
    ? '<div class="empty"><p>Nenhum envio com esse filtro.</p></div>'
    : `<ul class="rows">${visible.map((d) => dispatchItem(d, { groupName, timeZone, now, clicks })).join('')}</ul>`;

  return filters + list;
}
