// Tela de agendamentos: estado, carga, eventos, painel lateral e modais.
// Nada roda ao importar este arquivo: quem inicia a tela é o main.js. Assim
// os testes importam e chamam as funções com um document de mentira.

import { api } from './api.js';
import { escape, icon, pageHeader } from './html.js';
import { formatWhen } from './dates.js';
import { formatWhatsApp, toggleInline, toggleMonospace, toggleLinePrefix, insertText } from './whatsapp.js';
import { recentEmojis, rememberEmoji } from './emoji.js';
import { groupDispatches, lastDispatchByName } from './history.js';
import { statusBar } from './status-view.js';
import {
  scheduleList, scheduleForm, formCron, formGroups, searchKey, selectedCountLabel, sendConfirm, sendResult,
  schedulesSubtitle,
} from './schedules-view.js';
import { messageList, messageForm, emojiPanel, messagesSubtitle, bubbleContent } from './messages-view.js';
import { historyView, historySubtitle } from './history-view.js';
import { classifyMedia, validateFile, mediaStrip } from './media.js';

const STATUS_POLL_MS = 15_000;
const LOG_LIMIT = 500;
const TABS = ['schedules', 'messages', 'history'];

/** Estado da tela. Exportado para os testes. */
export const state = {
  schedules: [],
  messages: [],
  groups: [],
  groupsLoaded: false,
  groupsError: null,
  logs: [],
  status: null,
  statusError: null,
  // Diferença entre o relógio do servidor e o do navegador: "hoje" e
  // "amanhã" contam pelo relógio da máquina do agendador.
  clockOffset: 0,
  tab: 'schedules',
  // { type: 'schedule' | 'message', data, composing, snapshot }
  editing: null,
  sending: false,
  historyFilter: { name: '', onlyFailed: false },
  emojiTab: 'recent',
};

const $ = (selector) => document.querySelector(selector);
const drawer = () => $('#drawer');
const modal = () => $('#modal');
const now = () => Date.now() + state.clockOffset;
const timeZone = () => state.status?.timezone;
const groupName = (id) => state.groups.find((g) => g.id === id)?.name ?? id;
const fieldValue = (form, name) => form.querySelector(`[name="${name}"]`)?.value ?? '';
const mediaSrcFor = (media) => (media ? `/api/media/${encodeURIComponent(media.id)}` : '');

// ---------- Carga ----------

/**
 * Busca tudo da API e redesenha. O WAHA e o status podem falhar sem
 * derrubar o resto da tela.
 */
export async function load() {
  const [schedules, messages, logs] = await Promise.all([
    api('/schedules'),
    api('/messages'),
    api(`/logs?limit=${LOG_LIMIT}`),
  ]);
  Object.assign(state, { schedules, messages, logs });
  await refreshStatus({ quiet: true });
  render();
  await loadGroups();
}

async function reloadData() {
  const [schedules, messages] = await Promise.all([api('/schedules'), api('/messages')]);
  Object.assign(state, { schedules, messages });
  await refreshStatus({ quiet: true });
  render();
}

async function loadGroups() {
  try {
    state.groups = await api('/groups');
    state.groupsError = null;
  } catch (err) {
    state.groups = [];
    state.groupsError = err.message;
  }
  state.groupsLoaded = true;
  renderStatus();
  // Os cards e o histórico mostram os grupos pelo nome: redesenha a aba
  // agora que a lista chegou.
  renderTab();
  // O painel pode ter aberto antes da lista chegar, com o campo de ids
  // digitados. Se ninguém mexeu nele ainda, troca pela lista de grupos.
  if (state.editing?.type === 'schedule' && drawer().open && !isDirty()) renderScheduleDrawer({ fresh: true });
}

/**
 * Consulta o status do agendador. Sem `quiet`, redesenha a faixa e, se os
 * próximos envios mudaram (um disparo aconteceu), a aba e o histórico.
 * @param {{quiet?: boolean}} [options]
 */
export async function refreshStatus({ quiet = false } = {}) {
  const before = JSON.stringify(state.status?.nextRuns ?? null);
  try {
    const status = await api('/status');
    state.status = status;
    state.statusError = null;
    state.clockOffset = Date.parse(status.now) - Date.now();
  } catch (err) {
    state.statusError = err.message;
  }
  if (quiet) return;

  renderStatus();
  if (JSON.stringify(state.status?.nextRuns ?? null) !== before) {
    try {
      state.logs = await api(`/logs?limit=${LOG_LIMIT}`);
    } catch (err) {
      toast(`Não foi possível atualizar o histórico: ${err.message}`, 'error');
    }
    renderTab();
  }
}

// ---------- Desenho ----------

function render() {
  renderStatus();
  renderTabs();
  renderTab();
}

function renderStatus() {
  $('#status').innerHTML = statusBar({
    status: state.status,
    statusError: state.statusError,
    groupsError: state.groupsError,
    groupsLoaded: state.groupsLoaded,
    schedules: state.schedules,
    now: now(),
  });
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  for (const id of TABS) $(`#${id}`).hidden = id !== state.tab;
}

const TAB_TITLES = { schedules: 'Agendamentos', messages: 'Mensagens', history: 'Histórico' };

function primaryAction() {
  const action = {
    schedules: ['new-schedule', 'Novo agendamento'],
    messages: ['new-message', 'Nova mensagem'],
  }[state.tab];
  return action
    ? `<button type="button" class="btn btn-primary" data-action="${action[0]}">${icon('plus')} ${action[1]}</button>`
    : '';
}

function pageSubtitle() {
  if (state.tab === 'schedules') return schedulesSubtitle(state.schedules);
  if (state.tab === 'messages') return messagesSubtitle(state.messages);
  return historySubtitle(groupDispatches(state.logs));
}

// O cabeçalho conta os itens, então acompanha toda redesenho da aba.
function renderPageHead() {
  $('#page-head').innerHTML = pageHeader({
    title: TAB_TITLES[state.tab],
    subtitle: pageSubtitle(),
    action: primaryAction(),
  });
}

function renderTab() {
  renderPageHead();
  if (state.tab === 'schedules') {
    $('#schedules').innerHTML = scheduleList({
      schedules: state.schedules,
      messages: state.messages,
      nextRuns: state.status?.nextRuns,
      timeZone: timeZone(),
      now: now(),
      groupName,
      lastDispatches: lastDispatchByName(groupDispatches(state.logs)),
    });
  } else if (state.tab === 'messages') {
    $('#messages').innerHTML = messageList({ messages: state.messages, schedules: state.schedules });
  } else {
    $('#history').innerHTML = historyView({
      dispatches: groupDispatches(state.logs),
      filter: state.historyFilter,
      groupName,
      timeZone: timeZone(),
      now: now(),
    });
  }
}

function toast(message, tone = 'ok') {
  const el = document.createElement('div');
  el.className = `toast tone-${tone}`;
  el.innerHTML = `<span>${escape(message)}</span>${tone === 'error'
    ? `<button type="button" class="icon-btn" data-action="dismiss-toast" aria-label="Fechar aviso">${icon('x')}</button>`
    : ''}`;
  // O aviso de sucesso some sozinho, pela animação do CSS; o de erro fica
  // até ser fechado.
  el.addEventListener('animationend', () => el.remove());
  $('#toasts').append(el);
}

// Erro de formulário aparece dentro do painel ou do modal, perto do botão.
// Se ele já fechou, vira aviso solto, mas nunca some.
function showFormError(container, message) {
  const el = container.querySelector('.form-error');
  if (!el) {
    toast(message, 'error');
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function hideFormError(container) {
  const el = container.querySelector('.form-error');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

// ---------- Painel lateral ----------

function snapshotOf(form) {
  return JSON.stringify([...form.querySelectorAll('input, select, textarea')]
    .map((el) => (el.type === 'checkbox' ? el.checked : el.value)));
}

function isDirty() {
  const form = drawer().querySelector('form');
  return Boolean(form && state.editing && (state.editing.mediaDirty || snapshotOf(form) !== state.editing.snapshot));
}

// O anexo em edição: o pendente (escolhido agora, ainda não salvo) vence o
// atual (já gravado, servido pelo servidor).
function editingMedia() {
  const m = state.editing?.media;
  if (m?.pending) return { media: m.pending, src: m.pending.src };
  if (m?.current) return { media: m.current, src: mediaSrcFor(m.current) };
  return { media: null, src: '' };
}

// O que vai no corpo da mensagem: o arquivo novo em base64, a referência ao
// atual, ou nada.
function mediaPayload() {
  const m = state.editing?.media;
  if (m?.pending) return { filename: m.pending.filename, mimetype: m.pending.mimetype, data: m.pending.data };
  if (m?.current) return { id: m.current.id };
  return null;
}

function releasePendingMedia() {
  const src = state.editing?.media?.pending?.src;
  if (src) URL.revokeObjectURL(src);
}

function showDrawer(html, { fresh }) {
  const d = drawer();
  d.innerHTML = html;
  if (!d.open) d.showModal();
  if (fresh) state.editing.snapshot = snapshotOf(d.querySelector('form'));
}

function renderScheduleDrawer({ fresh = false } = {}) {
  const { media, src } = editingMedia();
  showDrawer(scheduleForm({
    schedule: state.editing.data,
    messages: state.messages,
    groups: state.groups,
    groupsError: state.groupsError,
    composing: state.editing.composing,
    timezoneLabel: state.status?.timezoneLabel,
    media,
    mediaSrc: src,
  }), { fresh });
  updatePreview(state.editing.data.cron ?? '');
}

/**
 * Abre o painel de agendamento: novo (sem id) ou edição.
 * @param {string} [id]
 */
export function openScheduleEditor(id) {
  const data = id
    ? structuredClone(state.schedules.find((s) => s.id === id))
    : { name: '', cron: '', messageId: state.messages[0]?.id, groups: [], enabled: true };
  state.editing = {
    type: 'schedule', data, composing: false, snapshot: '', media: { current: null, pending: null }, mediaDirty: false,
  };
  renderScheduleDrawer({ fresh: true });
}

/**
 * Abre o painel de mensagem: nova (sem id) ou edição.
 * @param {string} [id]
 */
export function openMessageEditor(id) {
  const data = id ? structuredClone(state.messages.find((m) => m.id === id)) : { name: '', text: '' };
  state.editing = {
    type: 'message', data, composing: false, snapshot: '', media: { current: data.media ?? null, pending: null }, mediaDirty: false,
  };
  showDrawer(messageForm({ message: data }), { fresh: true });
}

async function requestCloseDrawer() {
  if (isDirty()) {
    const discard = await confirmDialog({
      title: 'Descartar alterações?',
      body: 'O que você mudou neste formulário ainda não foi salvo.',
      confirm: 'Descartar',
      danger: true,
    });
    if (!discard) return;
  }
  closeDrawer();
}

function closeDrawer() {
  releasePendingMedia();
  state.editing = null;
  const d = drawer();
  if (d.open) d.close();
  d.innerHTML = '';
}

// Guarda o que está no formulário antes de redesenhá-lo (trocar entre
// mensagem existente e nova), para não perder o que já foi digitado.
function captureScheduleForm() {
  const form = drawer().querySelector('form');
  const data = state.editing.data;
  data.name = fieldValue(form, 'name');
  data.cron = formCron(form);
  data.groups = formGroups(form);
  const messageId = fieldValue(form, 'messageId');
  if (messageId) data.messageId = messageId;
}

// Token da última chamada em voo: a resposta de uma digitação antiga (rede
// lenta) não pode sobrescrever a prévia de uma digitação mais nova.
let previewToken = 0;

/**
 * Atualiza os próximos envios mostrados no formulário aberto.
 * @param {string} expr Cron que o formulário representa agora.
 */
export async function updatePreview(expr) {
  const el = drawer().querySelector('#preview');
  if (!el) return;
  const token = ++previewToken;

  if (!expr.trim()) {
    el.className = 'preview';
    el.textContent = 'Marque os dias e o horário para ver os próximos envios.';
    return;
  }

  try {
    const { valid, next, reason } = await api(`/cron/preview?expr=${encodeURIComponent(expr)}`);
    if (token !== previewToken) return;
    el.className = valid ? 'preview' : 'preview invalid';
    if (!valid) {
      // "reason" só vem quando a expressão passa na checagem estática mas o
      // node-cron recusa registrá-la: é a única pista do porquê.
      el.textContent = reason ? `Expressão cron inválida: ${reason}` : 'Expressão cron inválida';
    } else if (next.length === 0) {
      el.textContent = 'Nenhum envio previsto';
    } else {
      const when = next.map((d) => formatWhen(d, { timeZone: timeZone(), now: now() }));
      el.textContent = `Próximos envios: ${when.join(' · ')}`;
    }
  } catch (err) {
    if (token !== previewToken) return;
    // A falha não pode deixar os horários da expressão ANTERIOR parecendo
    // válidos ao lado de uma expressão nova.
    el.className = 'preview invalid';
    el.textContent = `Não foi possível calcular os próximos envios: ${err.message}`;
  }
}

function setDays(form, days) {
  form.querySelectorAll('input[name="day"]').forEach((input) => {
    input.checked = days.includes(Number(input.value));
  });
  updatePreview(formCron(form));
}

function filterGroups(input) {
  const query = searchKey(input.value.trim());
  input.form.querySelectorAll('.group').forEach((label) => {
    label.hidden = query !== '' && !label.dataset.name.includes(query);
  });
}

function updateGroupCount(form) {
  const counter = form.querySelector('#groups-count');
  if (counter) counter.textContent = selectedCountLabel(form.querySelectorAll('input[name="group"]:checked').length);
}

function updateMessagePreview(select) {
  const message = state.messages.find((m) => m.id === select.value);
  const preview = select.form.querySelector('#message-preview');
  if (preview) {
    preview.innerHTML = message
      ? bubbleContent({ text: message.text, media: message.media ?? null, mediaSrc: mediaSrcFor(message.media) })
      : '';
  }
}

// ---------- Editor de mensagem ----------

function updateEditorPreview(textarea) {
  const preview = textarea.closest('.editor').querySelector('[data-role="editor-preview"]');
  const { media, src } = editingMedia();
  preview.innerHTML = bubbleContent({ text: textarea.value, media, mediaSrc: src });
}

// Redesenha a tira e o balão depois de anexar ou remover, sem tocar no texto.
function refreshEditorMedia() {
  const d = drawer();
  const { media, src } = editingMedia();
  const strip = d.querySelector('[data-role="media-strip"]');
  if (strip) strip.innerHTML = media ? mediaStrip(media, src) : '';
  const preview = d.querySelector('[data-role="editor-preview"]');
  const text = d.querySelector('textarea[data-editor]')?.value ?? '';
  if (preview) preview.innerHTML = bubbleContent({ text, media, mediaSrc: src });
}

// Lê o arquivo escolhido em base64 (é assim que ele vai no corpo da mensagem)
// e guarda uma URL local para a prévia. O upload só acontece no salvar.
function attachFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const problem = validateFile(file);
  input.value = '';
  if (problem) {
    showFormError(drawer(), problem);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showFormError(drawer(), `Não foi possível ler "${file.name}".`);
  reader.onload = () => {
    if (!state.editing?.media) return;
    releasePendingMedia();
    const mimetype = file.type || 'application/octet-stream';
    state.editing.media = {
      current: null,
      pending: {
        filename: file.name,
        mimetype,
        size: file.size,
        kind: classifyMedia(mimetype),
        data: String(reader.result).split(',')[1] ?? '',
        src: URL.createObjectURL(file),
      },
    };
    state.editing.mediaDirty = true;
    hideFormError(drawer());
    refreshEditorMedia();
  };
  reader.readAsDataURL(file);
}

// Troca o texto do campo mantendo o desfazer (⌘Z) do navegador quando dá:
// execCommand('insertText') entra no histórico de edição; atribuir .value não.
function replaceText(textarea, { text, start, end }) {
  textarea.focus();
  textarea.setSelectionRange(0, textarea.value.length);
  if (!document.execCommand?.('insertText', false, text)) textarea.value = text;
  textarea.setSelectionRange(start, end);
  updateEditorPreview(textarea);
}

function applyFormat(button) {
  const editor = button.closest('.editor');
  if (button.dataset.format === 'emoji') {
    toggleEmojiPanel(editor);
    return;
  }
  if (button.dataset.format === 'attach') {
    editor.querySelector('[data-role="media-file"]').click();
    return;
  }
  const textarea = editor.querySelector('textarea[data-editor]');
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const formats = {
    bold: () => toggleInline(value, start, end, '*'),
    italic: () => toggleInline(value, start, end, '_'),
    strike: () => toggleInline(value, start, end, '~'),
    mono: () => toggleMonospace(value, start, end),
    bullet: () => toggleLinePrefix(value, start, end, 'bullet'),
    numbered: () => toggleLinePrefix(value, start, end, 'numbered'),
    quote: () => toggleLinePrefix(value, start, end, 'quote'),
  };
  replaceText(textarea, formats[button.dataset.format]());
}

// O localStorage pode lançar só por ser acessado (navegador bloqueando dados
// do site). Sem ele, a aba Recentes fica vazia; o resto funciona.
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function renderEmojiPanel(panel) {
  panel.innerHTML = emojiPanel({ active: state.emojiTab, recents: recentEmojis(storage()) });
}

function toggleEmojiPanel(editor) {
  const panel = editor.querySelector('[data-role="emoji-panel"]');
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  // Na primeira vez não há recentes: abre direto nos rostos.
  if (state.emojiTab === 'recent' && recentEmojis(storage()).length === 0) state.emojiTab = 'faces';
  renderEmojiPanel(panel);
  panel.hidden = false;
}

function pickEmoji(button) {
  const textarea = button.closest('.editor').querySelector('textarea[data-editor]');
  const emoji = button.dataset.emoji;
  rememberEmoji(storage(), emoji);
  replaceText(textarea, insertText(textarea.value, textarea.selectionStart, textarea.selectionEnd, emoji));
}

// ---------- Modais ----------

// Confirmação da tela, no lugar do confirm() do navegador. Resolve true só no
// botão de confirmar; Esc, clique fora e Cancelar resolvem false.
function confirmDialog({ title, body, confirm, danger = false }) {
  const m = modal();
  m.innerHTML = `
    <form method="dialog" class="modal-box">
      <h2 id="modal-title">${escape(title)}</h2>
      <p class="modal-text">${escape(body)}</p>
      <div class="modal-actions">
        <button type="submit" value="cancel" class="btn">Cancelar</button>
        <button type="submit" value="confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escape(confirm)}</button>
      </div>
    </form>`;
  m.returnValue = '';
  return new Promise((resolve) => {
    m.addEventListener('close', () => resolve(m.returnValue === 'confirm'), { once: true });
    m.showModal();
  });
}

function openSendModal(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  const message = state.messages.find((m) => m.id === schedule.messageId);
  const m = modal();
  m.innerHTML = sendConfirm({ schedule, message, groupName });
  m.returnValue = '';
  m.showModal();
}

async function confirmSend(button, id) {
  const m = modal();
  const schedule = state.schedules.find((s) => s.id === id);
  const cancel = m.querySelector('[data-action="close-modal"]');
  const label = button.innerHTML;
  // Um envio com vários grupos e intervalo entre eles pode levar dezenas de
  // segundos: o modal fica travado para um clique impaciente não mandar duas
  // vezes. Fila e retry são proibidos no projeto; a defesa é da tela.
  state.sending = true;
  button.disabled = true;
  cancel.disabled = true;
  button.classList.add('is-busy');
  button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Enviando…';
  hideFormError(m);

  let result;
  try {
    result = await api(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
  } catch (err) {
    button.disabled = false;
    cancel.disabled = false;
    button.classList.remove('is-busy');
    button.innerHTML = label;
    showFormError(m, err.message);
    return;
  } finally {
    state.sending = false;
  }

  m.innerHTML = sendResult({ schedule, result, groupName });
  try {
    state.logs = await api(`/logs?limit=${LOG_LIMIT}`);
    if (state.tab === 'history') renderTab();
  } catch (err) {
    toast(`Não foi possível atualizar o histórico: ${err.message}`, 'error');
  }
}

// ---------- Ações ----------

async function guarded(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleSchedule(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  await api(`/schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: !schedule.enabled }),
  });
  toast(schedule.enabled ? `"${schedule.name}" pausado` : `"${schedule.name}" ativado`);
  await reloadData();
}

async function deleteSchedule(id) {
  const schedule = state.schedules.find((s) => s.id === id);
  const ok = await confirmDialog({
    title: `Excluir "${schedule.name}"?`,
    body: 'O agendamento sai da lista e para de enviar. A mensagem continua na aba Mensagens.',
    confirm: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  await api(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast(`Agendamento "${schedule.name}" excluído`);
  await reloadData();
}

async function deleteMessage(id) {
  const message = state.messages.find((m) => m.id === id);
  const ok = await confirmDialog({
    title: `Excluir "${message.name}"?`,
    body: 'A mensagem sai da biblioteca. Se algum agendamento usa ela, a exclusão é recusada.',
    confirm: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  await api(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast(`Mensagem "${message.name}" excluída`);
  await reloadData();
}

async function persistSchedule(data) {
  const payload = { name: data.name, cron: data.cron, messageId: data.messageId, groups: data.groups };
  if (data.id) {
    await api(`/schedules/${encodeURIComponent(data.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...payload, enabled: data.enabled }),
    });
  } else {
    await api('/schedules', { method: 'POST', body: JSON.stringify(payload) });
  }
}

async function saveSchedule(form) {
  // O horário e o cron cru já são obrigatórios no próprio campo; o que o
  // navegador não barra é nenhum dia marcado.
  const cron = formCron(form);
  if (!cron) throw new Error('Selecione ao menos um dia da semana e o horário.');
  const groups = formGroups(form);
  // A API recusa lista vazia com 400. Barrar aqui evita a ida e volta e
  // deixa claro que desmarcar tudo não significa "herda os defaults".
  if (groups.length === 0) throw new Error('Selecione ao menos um grupo de destino.');

  const editing = state.editing;
  editing.data = { ...editing.data, name: fieldValue(form, 'name'), cron, groups };

  if (form.querySelector('[name="messageText"]')) {
    // "Escrever nova": grava a mensagem primeiro. Se o agendamento for
    // recusado depois, o painel volta com ela já escolhida, e tentar de novo
    // não cria outra.
    const media = mediaPayload();
    const created = await api('/messages', {
      method: 'POST',
      body: JSON.stringify({
        name: fieldValue(form, 'messageName'),
        text: fieldValue(form, 'messageText'),
        ...(media && { media }),
      }),
    });
    // A mensagem, e o anexo dela, já estão gravados: a partir daqui o painel
    // mostra o anexo servido pelo servidor, não o pendente.
    releasePendingMedia();
    editing.media = { current: null, pending: null };
    state.messages = [...state.messages, created];
    editing.data.messageId = created.id;
    editing.composing = false;
    try {
      await persistSchedule(editing.data);
    } catch (err) {
      renderScheduleDrawer();
      throw err;
    }
  } else {
    editing.data.messageId = fieldValue(form, 'messageId');
    await persistSchedule(editing.data);
  }

  const name = editing.data.name.trim();
  closeDrawer();
  toast(`Agendamento "${name}" salvo`);
  await reloadData();
}

async function saveMessage(form) {
  const media = mediaPayload();
  const payload = { name: fieldValue(form, 'name'), text: fieldValue(form, 'text'), ...(media && { media }) };
  const id = state.editing.data.id;
  await api(id ? `/messages/${encodeURIComponent(id)}` : '/messages', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  closeDrawer();
  toast(`Mensagem "${payload.name.trim()}" salva`);
  await reloadData();
}

// ---------- Eventos ----------

// Fecha o que flutua (menu "⋯", seletor de emojis) quando o clique é fora dele.
function closeFloating(target) {
  document.querySelectorAll('details.menu[open]').forEach((menu) => {
    if (!menu.contains(target)) menu.open = false;
  });
  document.querySelectorAll('[data-role="emoji-panel"]:not([hidden])').forEach((panel) => {
    if (!panel.parentElement.contains(target)) panel.hidden = true;
  });
}

/**
 * Delegação de cliques da tela inteira. Exportado para os testes.
 * @param {MouseEvent} evt
 */
export function handleClick(evt) {
  const target = evt.target;
  if (typeof target?.closest !== 'function') return;
  closeFloating(target);

  const tab = target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    renderTabs();
    renderTab();
    return;
  }

  const format = target.closest('[data-format]');
  if (format) {
    applyFormat(format);
    return;
  }

  const emojiTab = target.closest('[data-emoji-tab]');
  if (emojiTab) {
    state.emojiTab = emojiTab.dataset.emojiTab;
    renderEmojiPanel(emojiTab.closest('[data-role="emoji-panel"]'));
    return;
  }

  const emoji = target.closest('[data-emoji]');
  if (emoji) {
    pickEmoji(emoji);
    return;
  }

  const el = target.closest('[data-action]');
  if (!el || el.disabled) return;
  el.closest('details.menu')?.removeAttribute('open');
  const { action, id } = el.dataset;

  const actions = {
    'new-schedule': () => openScheduleEditor(),
    edit: () => openScheduleEditor(id),
    'new-message': () => openMessageEditor(),
    'edit-message': () => openMessageEditor(id),
    'close-drawer': () => requestCloseDrawer(),
    'close-modal': () => modal().close(),
    'compose-message': () => {
      captureScheduleForm();
      state.editing.composing = true;
      renderScheduleDrawer();
    },
    'pick-message': () => {
      captureScheduleForm();
      state.editing.composing = false;
      renderScheduleDrawer();
    },
    'days-weekdays': () => setDays(el.form, [1, 2, 3, 4, 5]),
    'days-all': () => setDays(el.form, [0, 1, 2, 3, 4, 5, 6]),
    toggle: () => guarded(() => toggleSchedule(id)),
    run: () => openSendModal(id),
    'confirm-send': () => confirmSend(el, id),
    'delete-schedule': () => guarded(() => deleteSchedule(id)),
    'delete-message': () => guarded(() => deleteMessage(id)),
    'history-all': () => {
      state.historyFilter.onlyFailed = false;
      renderTab();
    },
    'history-failed': () => {
      state.historyFilter.onlyFailed = true;
      renderTab();
    },
    'dismiss-toast': () => el.closest('.toast')?.remove(),
    'remove-media': () => {
      if (!state.editing?.media) return;
      releasePendingMedia();
      state.editing.media = { current: null, pending: null };
      state.editing.mediaDirty = true;
      refreshEditorMedia();
    },
  };
  actions[action]?.();
}

/**
 * Delegação de digitação. Exportado para os testes.
 * @param {InputEvent} evt
 */
export function handleInput(evt) {
  const target = evt.target;
  if (['day', 'time', 'cron'].includes(target.name)) {
    updatePreview(formCron(target.form));
  } else if (target.dataset?.editor !== undefined) {
    updateEditorPreview(target);
  } else if (target.dataset?.role === 'group-search') {
    filterGroups(target);
  }
}

function handleChange(evt) {
  const target = evt.target;
  if (target.name === 'group') {
    updateGroupCount(target.form);
  } else if (target.name === 'messageId') {
    updateMessagePreview(target);
  } else if (target.dataset?.role === 'history-name') {
    state.historyFilter.name = target.value;
    renderTab();
  } else if (target.dataset?.role === 'media-file') {
    attachFile(target);
  }
}

// Esc, ou outro pedido de fechar do navegador, fecha a camada de cima: o
// seletor de emojis, o modal (menos durante um envio) ou o painel, que
// pergunta antes de descartar alteração.
function dismissTopmost() {
  const m = modal();
  if (m.open) {
    if (!state.sending) m.close();
    return;
  }
  const d = drawer();
  if (!d.open) return;
  const panel = d.querySelector('[data-role="emoji-panel"]:not([hidden])');
  if (panel) panel.hidden = true;
  else requestCloseDrawer();
}

/**
 * Teclado: Esc para as camadas abertas e ⌘B/⌘I no editor. Exportado para os testes.
 * @param {KeyboardEvent} evt
 */
export function handleKeydown(evt) {
  if (evt.key === 'Escape' && (modal().open || drawer().open)) {
    // Cancelar o keydown impede o navegador de fechar o <dialog> sozinho: o
    // Chrome deixa de respeitar o preventDefault do "cancel" a partir do
    // segundo Esc seguido, e o painel fecharia sem perguntar.
    evt.preventDefault();
    dismissTopmost();
    return;
  }

  const target = evt.target;
  if (target.dataset?.editor === undefined || !(evt.metaKey || evt.ctrlKey)) return;
  const key = evt.key.toLowerCase();
  if (key !== 'b' && key !== 'i') return;
  evt.preventDefault();
  replaceText(target, toggleInline(target.value, target.selectionStart, target.selectionEnd, key === 'b' ? '*' : '_'));
}

/**
 * Envio dos formulários do painel. Exportado para os testes.
 * @param {SubmitEvent} evt
 */
export async function handleSubmit(evt) {
  const form = evt.target;
  // Formulário de modal (method="dialog") fecha sozinho com o valor do botão.
  if (form.getAttribute('method') === 'dialog') return;
  evt.preventDefault();

  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  hideFormError(drawer());
  try {
    if (form.id === 'form-schedule') await saveSchedule(form);
    else if (form.id === 'form-message') await saveMessage(form);
  } catch (err) {
    showFormError(drawer(), err.message);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
}

/** Liga os eventos, busca os dados e passa a acompanhar o status do agendador. */
export function start() {
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', handleKeydown);

  const d = drawer();
  // O Esc já é tratado no keydown; isto cobre os outros pedidos de fechar
  // do navegador (o botão voltar do Android, por exemplo).
  d.addEventListener('cancel', (evt) => {
    evt.preventDefault();
    dismissTopmost();
  });
  // Clique no fundo escurecido: o alvo é o próprio <dialog>, não o conteúdo.
  d.addEventListener('click', (evt) => {
    if (evt.target === d) requestCloseDrawer();
  });
  // Se o navegador fechar o painel por conta própria, a edição acabou.
  d.addEventListener('close', () => {
    state.editing = null;
  });

  const m = modal();
  m.addEventListener('cancel', (evt) => {
    evt.preventDefault();
    dismissTopmost();
  });
  m.addEventListener('click', (evt) => {
    if (evt.target === m && !state.sending) m.close();
  });

  setInterval(() => refreshStatus(), STATUS_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });

  load().catch((err) => toast(`Não foi possível carregar a tela: ${err.message}`, 'error'));
}
