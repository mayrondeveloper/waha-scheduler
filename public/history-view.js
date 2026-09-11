// Aba de histórico: envios agrupados por disparo, com filtros. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhen, formatTime } from './dates.js';

function dispatchItem(d, { groupName, timeZone, now }) {
  const total = d.entries.length;
  const entries = d.entries.map((e) => `
    <li class="${e.status === 'error' ? 'text-danger' : ''}">
      ${icon(e.status === 'error' ? 'x' : 'check')}
      <span>${escape(groupName(e.chatId))}${e.status === 'error' ? `: ${escape(e.error ?? 'falha sem detalhe')}` : ''}</span>
      <span class="entry-time">${escape(formatTime(e.ts, { timeZone, seconds: true }))}</span>
    </li>`).join('');

  return `
    <li>
      <details class="dispatch${d.failed ? ' has-failure' : ''}"${d.failed ? ' open' : ''}>
        <summary class="row dispatch-row">
          <span class="dispatch-icon ${d.failed ? 'tone-danger' : 'tone-ok'}">${icon(d.failed ? 'alert' : 'circleCheck')}</span>
          <span class="row-main"><span class="row-title-text">${escape(d.name)}</span>${d.manual ? '<span class="tag">manual</span>' : ''}</span>
          <span class="dispatch-count ${d.failed ? 'text-danger' : 'row-sub'}">${d.sent} de ${total} ${total === 1 ? 'grupo' : 'grupos'}</span>
          <span class="dispatch-when row-sub">${escape(formatWhen(d.startedAt, { timeZone, now }))}</span>
          <span class="chevron">${icon('chevronDown')}</span>
        </summary>
        <ul class="dispatch-entries">${entries}</ul>
      </details>
    </li>`;
}

/**
 * HTML do histórico.
 * @param {{dispatches: object[], filter: {name: string, onlyFailed: boolean},
 *          groupName: (id: string) => string, timeZone?: string, now?: number}} input
 *   dispatches: saída de groupDispatches.
 * @returns {string}
 */
export function historyView({ dispatches, filter, groupName, timeZone, now }) {
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
    : `<ul class="rows">${visible.map((d) => dispatchItem(d, { groupName, timeZone, now })).join('')}</ul>`;

  return filters + list;
}
