// Aba "Grupos": as listas de grupos e o painel de edição de uma lista. Só
// gera HTML.

import { escape, icon } from './html.js';
import { groupsSection } from './schedules-view.js';

const MAX_NAMES = 4;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Subtítulo do cabeçalho da aba: "2 listas".
 * @param {object[]} groupLists
 * @returns {string}
 */
export function listsSubtitle(groupLists) {
  const n = groupLists.length;
  if (n === 0) return 'Nenhuma lista';
  return n === 1 ? '1 lista' : `${n} listas`;
}

/**
 * HTML da aba de listas de grupos.
 * @param {{groupLists: object[], schedules: object[], groupName?: (id: string) => string}} input
 * @returns {string}
 */
export function listsView({ groupLists, schedules, groupName = (id) => id }) {
  if (groupLists.length === 0) {
    return `
      <div class="empty">
        <p class="empty-title">Crie sua primeira lista de grupos</p>
        <p>Uma lista junta os grupos que sempre recebem juntos. O agendamento escolhe a lista, e mudar a lista muda os próximos envios.</p>
        <button type="button" class="btn" data-action="new-list">${icon('plus')} Nova lista</button>
      </div>`;
  }

  const rows = groupLists.map((list) => {
    const usedBy = schedules.filter((s) => (s.groupLists ?? []).includes(list.id)).map((s) => s.name);
    const names = list.groups.slice(0, MAX_NAMES).map((id) => groupName(id));
    const rest = list.groups.length - names.length;
    const id = escape(list.id);
    return `
      <li class="row list-row">
        <div class="row-main">
          <button type="button" class="row-title" data-action="edit-list" data-id="${id}">${escape(list.name)}</button>
          <div class="row-sub">${plural(list.groups.length, 'grupo', 'grupos')} · ${escape(names.join(', '))}${rest > 0 ? ` e mais ${rest}` : ''}</div>
        </div>
        <div class="row-sub">${usedBy.length ? `Usada por ${escape(usedBy.join(', '))}` : 'Não usada'}</div>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit-list" data-id="${id}" title="Editar" aria-label="Editar ${escape(list.name)}">${icon('pencil')}</button>
          <button type="button" class="icon-btn danger" data-action="delete-list" data-id="${id}" title="Excluir" aria-label="Excluir ${escape(list.name)}">${icon('trash')}</button>
        </div>
      </li>`;
  }).join('');

  return `<ul class="rows">${rows}</ul>`;
}

/**
 * HTML do formulário de lista, no painel lateral. Usa o mesmo seletor de
 * grupos do agendamento, sem a parte de listas.
 * @param {{list: {id?: string, name?: string, groups?: string[]}, groups: {id: string, name: string}[],
 *          groupsError?: string|null}} input
 * @returns {string}
 */
export function listForm({ list, groups, groupsError = null }) {
  return `
    <form id="form-list" class="drawer-form" novalidate>
      <header class="drawer-header">
        <h2 id="drawer-title">${list.id ? 'Editar lista' : 'Nova lista'}</h2>
        <button type="button" class="icon-btn" data-action="close-drawer" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="drawer-body">
        <label class="field">
          <span class="field-label">Nome da lista</span>
          <input type="text" name="name" value="${escape(list.name ?? '')}" required autocomplete="off" placeholder="Ofertas SP" />
        </label>
        ${groupsSection({ saved: list.groups ?? [], groups, groupsError })}
      </div>
      <footer class="drawer-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn" data-action="close-drawer">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </footer>
    </form>`;
}
