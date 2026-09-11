// Aba de mensagens e o editor de mensagem, que também é usado no "Escrever
// nova" do formulário de agendamento. Só gera HTML.

import { escape, icon } from './html.js';
import { formatWhatsApp } from './whatsapp.js';
import { EMOJI_CATEGORIES } from './emoji.js';

const EMPTY_PREVIEW = '<span class="muted">A prévia aparece aqui.</span>';

// null é um separador entre grupos de botões.
const FORMAT_BUTTONS = [
  { format: 'bold', icon: 'bold', label: 'Negrito (⌘B)' },
  { format: 'italic', icon: 'italic', label: 'Itálico (⌘I)' },
  { format: 'strike', icon: 'strikethrough', label: 'Tachado' },
  { format: 'mono', icon: 'code', label: 'Monoespaçado' },
  null,
  { format: 'bullet', icon: 'list', label: 'Lista' },
  { format: 'numbered', icon: 'listOrdered', label: 'Lista numerada' },
  { format: 'quote', icon: 'quote', label: 'Citação' },
  null,
  { format: 'emoji', icon: 'smile', label: 'Emojis' },
];

/**
 * HTML do editor de mensagem: nome, barra de formatação, texto cru e prévia.
 * @param {{nameField: string, textField: string, name?: string, text?: string}} input
 *   nameField/textField: atributos "name" dos campos no formulário.
 * @returns {string}
 */
export function messageEditor({ nameField, textField, name = '', text = '' }) {
  const toolbar = FORMAT_BUTTONS.map((button) => (button
    ? `<button type="button" class="tool" data-format="${button.format}" title="${escape(button.label)}" aria-label="${escape(button.label)}">${icon(button.icon)}</button>`
    : '<span class="tool-sep" aria-hidden="true"></span>')).join('');

  return `
    <div class="editor">
      <label class="field">
        <span class="field-label">Nome da mensagem</span>
        <input type="text" name="${nameField}" value="${escape(name)}" required autocomplete="off" />
      </label>
      <div class="editor-grid">
        <div class="editor-input">
          <div class="toolbar" role="toolbar" aria-label="Formatação">${toolbar}</div>
          <textarea name="${textField}" data-editor rows="9" required aria-label="Texto da mensagem"
            placeholder="Bom dia! *Ofertas de hoje* 📚">${escape(text)}</textarea>
          <div class="emoji-panel" data-role="emoji-panel" hidden></div>
        </div>
        <div class="editor-preview">
          <p class="hint">Como chega no grupo</p>
          <div class="chat"><div class="bubble" data-role="editor-preview">${text.trim() ? formatWhatsApp(text) : EMPTY_PREVIEW}</div></div>
        </div>
      </div>
    </div>`;
}

/**
 * HTML do seletor de emojis, com a aba ativa.
 * @param {{active: string, recents: string[]}} input active: "recent" ou o id de uma categoria.
 * @returns {string}
 */
export function emojiPanel({ active, recents }) {
  const tabs = [{ id: 'recent', label: 'Recentes' }, ...EMOJI_CATEGORIES];
  const emojis = active === 'recent' ? recents : EMOJI_CATEGORIES.find((c) => c.id === active)?.emojis ?? [];
  const grid = emojis.length === 0
    ? '<p class="hint">Os emojis que você usar aparecem aqui.</p>'
    : emojis.map((e) => `<button type="button" class="emoji" data-emoji="${escape(e)}" aria-label="${escape(e)}">${escape(e)}</button>`).join('');

  return `
    <div class="emoji-tabs" role="tablist" aria-label="Categorias de emoji">
      ${tabs.map((t) => `<button type="button" role="tab" aria-selected="${t.id === active}" data-emoji-tab="${t.id}">${escape(t.label)}</button>`).join('')}
    </div>
    <div class="emoji-grid">${grid}</div>`;
}

/**
 * Subtítulo do cabeçalho da aba: "2 mensagens".
 * @param {object[]} messages
 * @returns {string}
 */
export function messagesSubtitle(messages) {
  const n = messages.length;
  if (n === 0) return 'Nenhuma mensagem';
  return n === 1 ? '1 mensagem' : `${n} mensagens`;
}

/**
 * HTML da lista de mensagens.
 * @param {{messages: object[], schedules: object[]}} input
 * @returns {string}
 */
export function messageList({ messages, schedules }) {
  if (messages.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Escreva sua primeira mensagem</p>
        <p>Uma mensagem pode ser usada por vários agendamentos.</p>
        <button type="button" class="btn" data-action="new-message">${icon('plus')} Nova mensagem</button>
      </div>`;
  }

  const rows = messages.map((m) => {
    const usedBy = schedules.filter((s) => s.messageId === m.id).map((s) => s.name);
    const id = escape(m.id);
    return `
      <li class="row message-row">
        <div class="row-main">
          <button type="button" class="row-title" data-action="edit-message" data-id="${id}">${escape(m.name)}</button>
          <div class="message-snippet">${formatWhatsApp(m.text)}</div>
        </div>
        <div class="row-sub">${usedBy.length ? `Usada por ${escape(usedBy.join(', '))}` : 'Não usada'}</div>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit-message" data-id="${id}" title="Editar" aria-label="Editar ${escape(m.name)}">${icon('pencil')}</button>
          <button type="button" class="icon-btn danger" data-action="delete-message" data-id="${id}" title="Excluir" aria-label="Excluir ${escape(m.name)}">${icon('trash')}</button>
        </div>
      </li>`;
  }).join('');

  return `<ul class="rows">${rows}</ul>`;
}

/**
 * HTML do formulário de mensagem, no painel lateral.
 * @param {{message: {id?: string, name?: string, text?: string}}} input
 * @returns {string}
 */
export function messageForm({ message }) {
  return `
    <form id="form-message" class="drawer-form" novalidate>
      <header class="drawer-header">
        <h2 id="drawer-title">${message.id ? 'Editar mensagem' : 'Nova mensagem'}</h2>
        <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="drawer-body">
        ${messageEditor({ nameField: 'name', textField: 'text', name: message.name ?? '', text: message.text ?? '' })}
      </div>
      <footer class="drawer-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn" data-action="close-drawer">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </footer>
    </form>`;
}
