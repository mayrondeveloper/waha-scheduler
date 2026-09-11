// Aba de agendamentos: a lista, o formulário do painel lateral e o modal de
// envio imediato. Só gera HTML e lê o formulário recebido.

import { escape, icon } from './html.js';
import { WEEKDAYS, buildCron, parseCron, describeCron } from './cron.js';
import { formatWhen } from './dates.js';
import { formatWhatsApp } from './whatsapp.js';
import { messageEditor } from './messages-view.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Chave de busca de um nome: minúsculas e sem acentos.
 * @param {string} value
 * @returns {string}
 */
export function searchKey(value) {
  return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Texto do contador de grupos marcados.
 * @param {number} count
 * @returns {string}
 */
export function selectedCountLabel(count) {
  return count === 1 ? '1 selecionado' : `${count} selecionados`;
}

function nextText(schedule, nextRuns, timeZone, now) {
  if (!schedule.enabled) return 'Pausado';
  if (!(schedule.id in nextRuns)) return '';
  const next = nextRuns[schedule.id];
  return next ? `Próximo: <strong>${escape(formatWhen(next, { timeZone, now }))}</strong>` : 'Nenhum envio previsto';
}

function scheduleRow(s, { messages, nextRuns, timeZone, now }) {
  const when = describeCron(s.cron);
  const message = messages.find((m) => m.id === s.messageId);
  const id = escape(s.id);
  const name = escape(s.name);
  return `
    <li class="row schedule-row${s.enabled ? '' : ' is-paused'}">
      <button type="button" class="switch" role="switch" aria-checked="${s.enabled}" data-action="toggle" data-id="${id}"
        aria-label="${s.enabled ? 'Pausar' : 'Ativar'} ${name}" title="${s.enabled ? 'Ativo: clique para pausar' : 'Pausado: clique para ativar'}"></button>
      <div class="row-main">
        <button type="button" class="row-title" data-action="edit" data-id="${id}">${name}</button>
        <div class="row-sub">${when ? escape(when) : `<code>${escape(s.cron)}</code>`} · ${escape(message?.name ?? 'mensagem não encontrada')}</div>
      </div>
      <div class="row-next">${nextText(s, nextRuns, timeZone, now)}</div>
      <div class="row-count">${plural(s.groups.length, 'grupo', 'grupos')}</div>
      <div class="row-actions">
        <button type="button" class="btn btn-danger-outline btn-sm" data-action="run" data-id="${id}">${icon('send')} Enviar agora</button>
        <details class="menu">
          <summary class="icon-btn" aria-label="Mais ações para ${name}">${icon('ellipsis')}</summary>
          <div class="menu-items">
            <button type="button" data-action="edit" data-id="${id}">${icon('pencil')} Editar</button>
            <button type="button" class="danger" data-action="delete-schedule" data-id="${id}">${icon('trash')} Excluir</button>
          </div>
        </details>
      </div>
    </li>`;
}

/**
 * HTML da lista de agendamentos.
 * @param {{schedules: object[], messages: object[], nextRuns?: Record<string, string|null>,
 *          timeZone?: string, now?: number}} input nextRuns: de GET /api/status.
 * @returns {string}
 */
export function scheduleList({ schedules, messages, nextRuns = {}, timeZone, now }) {
  if (schedules.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Crie seu primeiro agendamento</p>
        <p>Escolha a mensagem, os dias, o horário e os grupos. O agendador envia sozinho.</p>
        <button type="button" class="btn" data-action="new-schedule">${icon('plus')} Novo agendamento</button>
      </div>`;
  }
  return `<ul class="rows">${schedules.map((s) => scheduleRow(s, { messages, nextRuns, timeZone, now })).join('')}</ul>`;
}

// Um cron personalizado (editado à mão no arquivo) aparece cru e é mantido
// como está: convertê-lo em dias e horário em silêncio mudaria quando o
// agendamento dispara, num save que talvez só quisesse trocar a mensagem.
function whenSection(schedule, timezoneLabel) {
  const when = schedule.cron ? parseCron(schedule.cron) : { days: [], time: '' };
  const zone = timezoneLabel ? `${escape(timezoneLabel)}. ` : '';
  const preview = `<p class="hint">${zone}<span id="preview" class="preview">—</span></p>`;

  if (!when) {
    return `
      <fieldset class="field">
        <legend class="field-label">Quando</legend>
        <p class="note">Este agendamento usa um cron personalizado, que não cabe em dias e horário. Ele é mantido como está.</p>
        <input type="text" name="cron" value="${escape(schedule.cron)}" required autocomplete="off" aria-label="Expressão cron" />
        ${preview}
      </fieldset>`;
  }

  const days = WEEKDAYS.map((d) => `
          <label class="day">
            <input type="checkbox" name="day" value="${escape(d.value)}" ${when.days.includes(d.value) ? 'checked' : ''} />
            <span>${escape(d.label)}</span>
          </label>`).join('');

  return `
    <fieldset class="field">
      <legend class="field-label">Quando</legend>
      <div class="days">${days}</div>
      <div class="when-row">
        <button type="button" class="link" data-action="days-weekdays">Dias úteis</button>
        <button type="button" class="link" data-action="days-all">Todo dia</button>
        <label class="time">
          <span class="visually-hidden">Horário</span>
          <input type="time" name="time" value="${escape(when.time)}" required />
        </label>
      </div>
      ${preview}
    </fieldset>`;
}

function messageSection(schedule, messages, composing) {
  if (composing || messages.length === 0) {
    const pick = messages.length > 0
      ? '<button type="button" class="link field-aside" data-action="pick-message">Escolher uma existente</button>'
      : '';
    return `
      <fieldset class="field">
        <legend class="field-label">Mensagem</legend>
        ${pick}
        ${messageEditor({ nameField: 'messageName', textField: 'messageText', name: schedule.name ?? '' })}
      </fieldset>`;
  }

  const selected = messages.find((m) => m.id === schedule.messageId) ?? messages[0];
  const options = messages
    .map((m) => `<option value="${escape(m.id)}" ${m.id === selected.id ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');
  return `
    <fieldset class="field">
      <legend class="field-label">Mensagem</legend>
      <button type="button" class="link field-aside" data-action="compose-message">${icon('plus')} Escrever nova</button>
      <select name="messageId" required aria-label="Mensagem">${options}</select>
      <div class="chat"><div class="bubble" id="message-preview">${formatWhatsApp(selected.text)}</div></div>
    </fieldset>`;
}

function groupsSection(saved, groups, groupsError) {
  // Sem lista do WAHA, o campo livre já vem preenchido com os ids salvos:
  // nada se perde por o WAHA estar fora do ar.
  if (groups.length === 0) {
    const note = groupsError
      ? 'A lista de grupos do WAHA não está disponível. Digite os ids separados por vírgula.'
      : 'Carregando a lista de grupos do WAHA. Enquanto isso, dá para digitar os ids separados por vírgula.';
    return `
      <fieldset class="field">
        <legend class="field-label">Grupos</legend>
        <p class="note">${note}</p>
        <input type="text" id="groups-text" value="${escape(saved.join(','))}" placeholder="120363000000000000@g.us" autocomplete="off" aria-label="Ids dos grupos" />
      </fieldset>`;
  }

  // Um grupo já salvo que o WAHA não lista (o bot saiu do grupo, a sessão
  // reconectou com a lista parcial, o id foi digitado à mão) continua no
  // formulário, marcado, sinalizado e primeiro: é o que o usuário precisa
  // decidir. Se ele sumisse, formGroups() devolveria a lista sem ele e o
  // save trocaria o destino em silêncio.
  const missing = saved.filter((id) => !groups.some((g) => g.id === id));
  const option = (id, name, notFound) => `
        <label class="group${notFound ? ' group-missing' : ''}" data-name="${escape(searchKey(name))}">
          <input type="checkbox" name="group" value="${escape(id)}" ${saved.includes(id) ? 'checked' : ''} />
          <span class="group-name">${escape(name)}</span>
          ${notFound ? '<small class="warn">não encontrado na lista atual do WAHA</small>' : `<small class="group-id">${escape(id)}</small>`}
        </label>`;

  return `
    <fieldset class="field">
      <legend class="field-label">Grupos</legend>
      <span class="field-aside" id="groups-count">${selectedCountLabel(saved.length)}</span>
      <input type="search" class="group-search" data-role="group-search" placeholder="Buscar grupo" aria-label="Buscar grupo" autocomplete="off" />
      <div class="group-list">
        ${missing.map((id) => option(id, id, true)).join('')}
        ${groups.map((g) => option(g.id, g.name, false)).join('')}
      </div>
    </fieldset>`;
}

/**
 * HTML do formulário de agendamento, no painel lateral.
 * @param {{schedule: object, messages: object[], groups: {id: string, name: string}[],
 *          groupsError?: string|null, composing?: boolean, timezoneLabel?: string}} input
 *   schedule: o agendamento em edição (sem id quando é novo).
 *   groups: lista do WAHA; vazia quando ela não chegou.
 *   composing: true mostra o editor de mensagem nova no lugar da seleção.
 * @returns {string}
 */
export function scheduleForm({ schedule, messages, groups, groupsError = null, composing = false, timezoneLabel = '' }) {
  return `
    <form id="form-schedule" class="drawer-form" novalidate>
      <header class="drawer-header">
        <h2 id="drawer-title">${schedule.id ? 'Editar agendamento' : 'Novo agendamento'}</h2>
        <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="drawer-body">
        <label class="field">
          <span class="field-label">Nome</span>
          <input type="text" name="name" value="${escape(schedule.name ?? '')}" required autocomplete="off" />
        </label>
        ${whenSection(schedule, timezoneLabel)}
        ${messageSection(schedule, messages, composing)}
        ${groupsSection(schedule.groups ?? [], groups, groupsError)}
      </div>
      <footer class="drawer-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn" data-action="close-drawer">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </footer>
    </form>`;
}

/**
 * Cron que o formulário representa agora: o campo cru, se o agendamento tem
 * cron personalizado; senão, o montado a partir dos dias e do horário.
 * Devolve '' enquanto faltar dia ou horário.
 * @param {{querySelector: Function, querySelectorAll: Function}} form
 * @returns {string}
 */
export function formCron(form) {
  const custom = form.querySelector('input[name="cron"]');
  if (custom) return custom.value.trim();

  const days = [...form.querySelectorAll('input[name="day"]:checked')].map((input) => Number(input.value));
  const time = form.querySelector('input[name="time"]')?.value ?? '';
  return days.length > 0 && time ? buildCron(days, time) : '';
}

/**
 * Grupos marcados no formulário, ou os digitados quando a lista do WAHA não veio.
 * @param {{querySelector: Function, querySelectorAll: Function}} form
 * @returns {string[]}
 */
export function formGroups(form) {
  const text = form.querySelector('#groups-text');
  if (text) return text.value.split(',').map((g) => g.trim()).filter(Boolean);
  return [...form.querySelectorAll('input[name="group"]:checked')].map((input) => input.value);
}

/**
 * HTML do modal que confirma um envio imediato.
 * @param {{schedule: object, message: object|undefined, groupName: (id: string) => string}} input
 * @returns {string}
 */
export function sendConfirm({ schedule, message, groupName }) {
  const count = schedule.groups.length;
  return `
    <div class="modal-box">
      <h2 id="modal-title">Enviar "${escape(schedule.name)}" agora?</h2>
      <p class="modal-text">A mensagem vai de verdade para ${count === 1 ? 'o grupo abaixo' : 'os grupos abaixo'}, fora do horário agendado.</p>
      <div class="chat"><div class="bubble">${message ? formatWhatsApp(message.text) : '<span class="muted">Mensagem não encontrada.</span>'}</div></div>
      <ul class="chips">${schedule.groups.map((id) => `<li class="chip">${escape(groupName(id))}</li>`).join('')}</ul>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancelar</button>
        <button type="button" class="btn btn-danger" data-action="confirm-send" data-id="${escape(schedule.id)}">${icon('send')} Enviar para ${plural(count, 'grupo', 'grupos')}</button>
      </div>
    </div>`;
}

/**
 * HTML do resultado de um envio imediato.
 * @param {{schedule: object, result: {sent: number, failed: number, results: object[]},
 *          groupName: (id: string) => string}} input result: resposta de POST /run.
 * @returns {string}
 */
export function sendResult({ schedule, result, groupName }) {
  const total = result.sent + result.failed;
  const failures = result.results.filter((r) => r.status === 'error');
  const list = failures.length
    ? `<ul class="failures">${failures.map((f) => `<li>${icon('x')}<span><strong>${escape(groupName(f.chatId))}</strong>: ${escape(f.error ?? 'falha sem detalhe')}</span></li>`).join('')}</ul>`
    : '';
  return `
    <div class="modal-box">
      <h2 id="modal-title">Enviado para ${result.sent} de ${plural(total, 'grupo', 'grupos')}</h2>
      <p class="modal-text">"${escape(schedule.name)}" ${failures.length ? 'teve falhas:' : 'foi enviado agora.'}</p>
      ${list}
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-action="close-modal">Fechar</button>
      </div>
    </div>`;
}
