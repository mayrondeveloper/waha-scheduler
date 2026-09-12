// Aba de agendamentos: a lista, o formulário do painel lateral e o modal de
// envio imediato. Só gera HTML e lê o formulário recebido.

import { escape, icon, badge } from './html.js';
import { WEEKDAYS, buildCron, parseCron, describeCron } from './cron.js';
import { formatWhen, describeAt } from './dates.js';
import { formatWhatsApp } from './whatsapp.js';
import { messageEditor, bubbleContent } from './messages-view.js';

const mediaSrcFor = (media) => (media ? `/api/media/${encodeURIComponent(media.id)}` : '');

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

/**
 * Subtítulo do cabeçalho da aba: "3 agendamentos · 1 ativo".
 * @param {object[]} schedules
 * @returns {string}
 */
export function schedulesSubtitle(schedules) {
  const n = schedules.length;
  if (n === 0) return 'Nenhum agendamento';
  const active = schedules.filter((s) => s.enabled).length;
  const activeText = active === 0 ? 'nenhum ativo' : active === 1 ? '1 ativo' : `${active} ativos`;
  return `${n === 1 ? '1 agendamento' : `${n} agendamentos`} · ${activeText}`;
}

function nextText(schedule, nextRuns, timeZone, now) {
  // Envio único já resolvido: o que aconteceu, no lugar do próximo.
  if (schedule.firedAt) return `Enviado em <strong>${escape(formatWhen(schedule.firedAt, { timeZone, now }))}</strong>`;
  if (schedule.missedAt) return `Perdido · o agendador estava parado às ${escape(schedule.at.slice(11))}`;
  if (!schedule.enabled) return 'Próximo: —';
  if (!(schedule.id in nextRuns)) return '';
  const next = nextRuns[schedule.id];
  return next ? `Próximo: <strong>${escape(formatWhen(next, { timeZone, now }))}</strong>` : 'Nenhum envio previsto';
}

// Pausado é escolha do usuário e vence; depois vem o resultado do envio
// único (enviado, perdido) ou do último envio; senão, ativo.
function statusBadge(schedule, last) {
  if (!schedule.enabled) return badge('paused', 'Pausado');
  if (schedule.missedAt) return badge('error', 'Perdido');
  if (last?.failed > 0) return badge('error', 'Falha no envio');
  if (schedule.firedAt) return badge('waiting', 'Enviado');
  return badge('active', 'Ativo');
}

// "Quando" do card: os dias por extenso, o cron cru ou a data do envio único.
function whenText(s, timeZone, now) {
  if (s.at) return `Uma vez · ${escape(describeAt(s.at, { timeZone, now }))}`;
  const when = describeCron(s.cron);
  return when ? escape(when) : `<code>${escape(s.cron)}</code>`;
}

const MAX_GROUP_NAMES = 4;

function groupsText(groups, groupName) {
  if (groups.length === 0) return 'Nenhum grupo';
  const names = groups.slice(0, MAX_GROUP_NAMES).map((id) => groupName(id));
  const rest = groups.length - names.length;
  return `${plural(groups.length, 'grupo', 'grupos')} · ${escape(names.join(', '))}${rest > 0 ? ` e mais ${rest}` : ''}`;
}

function failureLine(last, timeZone, now) {
  if (!last || last.failed === 0) return '';
  const error = last.entries.find((e) => e.status === 'error')?.error ?? 'falha sem detalhe';
  return `<div class="card-failure">${icon('alert')} Último envio falhou · ${escape(error)} · ${escape(formatWhen(last.startedAt, { timeZone, now }))}</div>`;
}

function scheduleCard(s, index, { messages, nextRuns, timeZone, now, groupName, lastDispatches }) {
  const message = messages.find((m) => m.id === s.messageId);
  const last = lastDispatches[s.name];
  const id = escape(s.id);
  const name = escape(s.name);
  const failing = s.enabled && (last?.failed > 0 || Boolean(s.missedAt));
  const classes = ['card', 'schedule-card', s.enabled ? '' : 'is-paused', failing ? 'has-failure' : '']
    .filter(Boolean).join(' ');
  return `
    <li class="${classes}" style="--i: ${Math.min(index, 8)}">
      <button type="button" class="switch" role="switch" aria-checked="${s.enabled}" data-action="toggle" data-id="${id}"
        aria-label="${s.enabled ? 'Pausar' : 'Ativar'} ${name}" title="${s.enabled ? 'Ativo: clique para pausar' : 'Pausado: clique para ativar'}"></button>
      <div class="card-main">
        <div class="card-title-row">
          <button type="button" class="card-title" data-action="edit" data-id="${id}">${name}</button>
          ${statusBadge(s, last)}
        </div>
        <div class="card-sub">${whenText(s, timeZone, now)} · ${escape(message?.name ?? 'mensagem não encontrada')}</div>
        <div class="card-meta">${nextText(s, nextRuns, timeZone, now)}</div>
        <div class="card-sub">${groupsText(s.groups, groupName)}</div>
        ${failureLine(last, timeZone, now)}
      </div>
      <div class="card-actions">
        <button type="button" class="btn btn-sm" data-action="run" data-id="${id}">${icon('send')} Enviar agora</button>
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
 * HTML da lista de agendamentos, um card por agendamento.
 * @param {{schedules: object[], messages: object[], nextRuns?: Record<string, string|null>,
 *          timeZone?: string, now?: number, groupName?: (id: string) => string,
 *          lastDispatches?: Record<string, object>}} input
 *   nextRuns: de GET /api/status. lastDispatches: de lastDispatchByName, para
 *   o badge "Falha no envio" e a linha do último envio falho.
 * @returns {string}
 */
export function scheduleList({ schedules, messages, nextRuns = {}, timeZone, now, groupName = (id) => id, lastDispatches = {} }) {
  if (schedules.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Crie seu primeiro agendamento</p>
        <p>Escolha a mensagem, os dias, o horário e os grupos. O agendador envia sozinho.</p>
        <button type="button" class="btn" data-action="new-schedule">${icon('plus')} Novo agendamento</button>
      </div>`;
  }
  const context = { messages, nextRuns, timeZone, now, groupName, lastDispatches };
  return `<ul class="cards">${schedules.map((s, index) => scheduleCard(s, index, context)).join('')}</ul>`;
}

// Bloco do formulário com título e, à direita, um complemento opcional (link
// ou contador). É um grupo rotulado (role="group" + aria-labelledby), que o
// leitor de tela trata como um fieldset, em vez de fieldset/legend: o
// navegador desenha a legend fora da área de conteúdo, e o complemento
// posicionado caía por cima do primeiro campo.
function fieldGroup(id, label, aside, body) {
  return `
    <div class="field" role="group" aria-labelledby="${id}">
      <div class="field-head"><span class="field-label" id="${id}">${label}</span>${aside}</div>
      ${body}
    </div>`;
}

// Bloco de repetição: dias e horário, ou o cron cru. Um cron personalizado
// (editado à mão no arquivo) aparece cru e é mantido como está: convertê-lo
// em dias e horário em silêncio mudaria quando o agendamento dispara, num
// save que talvez só quisesse trocar a mensagem.
function repeatBlock(schedule) {
  const when = schedule.cron ? parseCron(schedule.cron) : { days: [], time: '' };
  if (!when) {
    return `
      <p class="note">Este agendamento usa um cron personalizado, que não cabe em dias e horário. Ele é mantido como está.</p>
      <input type="text" name="cron" value="${escape(schedule.cron)}" required autocomplete="off" aria-label="Expressão cron" />`;
  }

  const days = WEEKDAYS.map((d) => `
        <label class="day">
          <input type="checkbox" name="day" value="${escape(d.value)}" ${when.days.includes(d.value) ? 'checked' : ''} />
          <span>${escape(d.label)}</span>
        </label>`).join('');

  return `
      <div class="days">${days}</div>
      <div class="when-row">
        <button type="button" class="link" data-action="days-weekdays">Dias úteis</button>
        <button type="button" class="link" data-action="days-all">Todo dia</button>
        <label class="time">
          <span class="visually-hidden">Horário</span>
          <input type="time" name="time" value="${escape(when.time)}" />
        </label>
      </div>`;
}

// Bloco do envio único: data e horário, no fuso do agendador.
function onceBlock(schedule) {
  const [date = '', time = ''] = (schedule.at ?? '').split('T');
  return `
      <div class="when-row when-once">
        <label class="date">
          <span class="visually-hidden">Data</span>
          <input type="date" name="date" value="${escape(date)}" />
        </label>
        <label class="time">
          <span class="visually-hidden">Horário</span>
          <input type="time" name="onceTime" value="${escape(time)}" />
        </label>
      </div>`;
}

// Modo do bloco "Quando": o que a tela guardou ao alternar, senão o que o
// agendamento é.
function whenMode(schedule) {
  return schedule.mode ?? (schedule.at ? 'once' : 'repeat');
}

function whenSection(schedule, timezoneLabel) {
  const mode = whenMode(schedule);
  const zone = timezoneLabel ? `${escape(timezoneLabel)}. ` : '';
  const segment = (value, label) =>
    `<button type="button" data-action="when-${value}" aria-pressed="${mode === value}">${label}</button>`;

  return fieldGroup('label-when', 'Quando', '', `
      <div class="segmented when-mode" role="group" aria-label="Repetir ou enviar uma vez">${segment('repeat', 'Repetir')}${segment('once', 'Uma vez')}</div>
      <input type="hidden" name="mode" value="${mode}" />
      <div data-role="when-repeat" ${mode === 'repeat' ? '' : 'hidden'}>${repeatBlock(schedule)}</div>
      <div data-role="when-once" ${mode === 'once' ? '' : 'hidden'}>${onceBlock(schedule)}</div>
      <p class="hint">${zone}<span id="preview" class="preview">—</span></p>`);
}

function messageSection(schedule, messages, composing, media, mediaSrc) {
  if (composing || messages.length === 0) {
    const pick = messages.length > 0
      ? '<button type="button" class="link" data-action="pick-message">Escolher uma existente</button>'
      : '';
    return fieldGroup('label-message', 'Mensagem', pick,
      messageEditor({ nameField: 'messageName', textField: 'messageText', name: schedule.name ?? '', media, mediaSrc }));
  }

  const selected = messages.find((m) => m.id === schedule.messageId) ?? messages[0];
  const options = messages
    .map((m) => `<option value="${escape(m.id)}" ${m.id === selected.id ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');
  const compose = `<button type="button" class="link" data-action="compose-message">${icon('plus')} Escrever nova</button>`;
  const preview = bubbleContent({ text: selected.text, media: selected.media ?? null, mediaSrc: mediaSrcFor(selected.media) });
  return fieldGroup('label-message', 'Mensagem', compose, `
      <select name="messageId" required aria-labelledby="label-message">${options}</select>
      <div class="chat"><div class="bubble" id="message-preview">${preview}</div></div>`);
}

function groupsSection(saved, groups, groupsError) {
  // Sem lista do WAHA, o campo livre já vem preenchido com os ids salvos:
  // nada se perde por o WAHA estar fora do ar.
  if (groups.length === 0) {
    const note = groupsError
      ? 'A lista de grupos do WAHA não está disponível. Digite os ids separados por vírgula.'
      : 'Carregando a lista de grupos do WAHA. Enquanto isso, dá para digitar os ids separados por vírgula.';
    return fieldGroup('label-groups', 'Grupos', '', `
      <p class="note">${note}</p>
      <input type="text" id="groups-text" value="${escape(saved.join(','))}" placeholder="120363000000000000@g.us" autocomplete="off" aria-label="Ids dos grupos" />`);
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

  const count = `<span class="field-count" id="groups-count">${selectedCountLabel(saved.length)}</span>`;
  return fieldGroup('label-groups', 'Grupos', count, `
      <input type="search" class="group-search" data-role="group-search" placeholder="Buscar grupo" aria-label="Buscar grupo" autocomplete="off" />
      <div class="group-list">
        ${missing.map((id) => option(id, id, true)).join('')}
        ${groups.map((g) => option(g.id, g.name, false)).join('')}
      </div>`);
}

/**
 * HTML do formulário de agendamento, no painel lateral.
 * @param {{schedule: object, messages: object[], groups: {id: string, name: string}[],
 *          groupsError?: string|null, composing?: boolean, timezoneLabel?: string}} input
 *   schedule: o agendamento em edição (sem id quando é novo).
 *   groups: lista do WAHA; vazia quando ela não chegou.
 *   composing: true mostra o editor de mensagem nova no lugar da seleção.
 *   media/mediaSrc: anexo da mensagem nova em edição e a URL da prévia.
 * @returns {string}
 */
export function scheduleForm({
  schedule, messages, groups, groupsError = null, composing = false, timezoneLabel = '', media = null, mediaSrc = '',
}) {
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
        ${messageSection(schedule, messages, composing, media, mediaSrc)}
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
 * O "quando" que o formulário representa agora: `{ cron }` no modo Repetir
 * (vazio enquanto faltar dia ou horário) ou `{ at }` no modo Uma vez (vazio
 * enquanto faltar data ou horário).
 * @param {{querySelector: Function, querySelectorAll: Function}} form
 * @returns {{cron: string} | {at: string}}
 */
export function formWhen(form) {
  const mode = form.querySelector('input[name="mode"]')?.value ?? 'repeat';
  if (mode !== 'once') return { cron: formCron(form) };
  const date = form.querySelector('input[name="date"]')?.value ?? '';
  const time = form.querySelector('input[name="onceTime"]')?.value ?? '';
  return { at: date && time ? `${date}T${time}` : '' };
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
      <div class="chat"><div class="bubble">${message
        ? bubbleContent({ text: message.text, media: message.media ?? null, mediaSrc: mediaSrcFor(message.media) })
        : '<span class="muted">Mensagem não encontrada.</span>'}</div></div>
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
