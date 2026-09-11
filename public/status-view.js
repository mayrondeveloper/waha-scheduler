// Faixa de status da tela: agendador, WAHA e próximo envio. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhen } from './dates.js';

/**
 * Qual aviso do agendador mostrar. Quando mais de um se aplica, vale o
 * primeiro desta ordem: sem conexão com o servidor da tela, nenhum
 * agendamento ativo, agendador parado ou sem resposta, recarga recusada,
 * rodando.
 * @param {{status: object|null, statusError: string|null, schedules: object[], now?: number}} input
 * @returns {{tone: 'ok'|'warn'|'danger'|'neutral', text: string, detail?: string}}
 */
export function schedulerNotice({ status, statusError, schedules, now }) {
  if (statusError) {
    return { tone: 'danger', text: 'Sem conexão com o servidor da tela', detail: statusError };
  }
  // O agendador encerra sozinho quando não há nada ativo: não é alarme.
  if (!schedules.some((s) => s.enabled)) {
    return { tone: 'neutral', text: 'Nenhum agendamento ativo' };
  }
  if (!status) return { tone: 'neutral', text: 'Verificando o agendador…' };

  const { state, beatAt, reloadError } = status.scheduler;
  if (state === 'stopped') {
    return { tone: 'danger', text: 'Agendador parado', detail: 'Nada vai sair até você rodar npm start.' };
  }
  if (state === 'unresponsive') {
    const last = beatAt ? `Último sinal: ${formatWhen(beatAt, { timeZone: status.timezone, now })}. ` : '';
    return {
      tone: 'danger',
      text: 'Agendador parou de responder',
      detail: `${last}Nada vai sair até ele voltar; se não voltar, rode npm start de novo.`,
    };
  }
  if (reloadError) {
    return { tone: 'warn', text: 'O agendador recusou a última alteração e segue com a anterior', detail: reloadError };
  }
  return { tone: 'ok', text: 'Agendador rodando' };
}

/**
 * O próximo envio entre todos os agendamentos ativos.
 * @param {object[]} schedules
 * @param {Record<string, string|null>|undefined} nextRuns
 * @returns {{schedule: object, at: string} | null}
 */
export function nextDispatch(schedules, nextRuns) {
  let best = null;
  for (const schedule of schedules) {
    const at = nextRuns?.[schedule.id];
    if (!schedule.enabled || !at) continue;
    if (!best || Date.parse(at) < Date.parse(best.at)) best = { schedule, at };
  }
  return best;
}

// "live" liga o pulso do ponto: é o indicador de vida do sistema, só para o
// agendador rodando.
function item({ tone, text, detail }, live = false) {
  return `
    <span class="status-item tone-${tone}${live ? ' is-live' : ''}">
      <span class="dot" aria-hidden="true"></span>
      <span>${escape(text)}${detail ? `<span class="status-detail">${escape(detail)}</span>` : ''}</span>
    </span>`;
}

/**
 * HTML da faixa de status.
 * @param {{status: object|null, statusError: string|null, groupsError: string|null,
 *          groupsLoaded: boolean, schedules: object[], now?: number}} input
 * @returns {string}
 */
export function statusBar(input) {
  const notice = schedulerNotice(input);
  const { status, groupsError, groupsLoaded, schedules, now } = input;
  const waha = groupsError
    ? { tone: 'warn', text: 'WAHA indisponível', detail: groupsError }
    : groupsLoaded ? { tone: 'ok', text: 'WAHA conectado' } : { tone: 'neutral', text: 'Verificando o WAHA…' };

  // Com o agendador parado, "próximo envio" enganaria: nada vai sair.
  const running = notice.tone === 'ok' || notice.tone === 'warn';
  const next = running && status ? nextDispatch(schedules, status.nextRuns) : null;
  const nextHtml = next
    ? `<span class="status-next">${icon('clock')} Próximo envio: ${escape(formatWhen(next.at, { timeZone: status.timezone, now }))}, ${escape(next.schedule.name)}</span>`
    : '';

  return `${item(notice, notice.tone === 'ok')}${item(waha)}${nextHtml}`;
}
