// Tela de agendamentos: busca o estado da API e redesenha a cada alteração.

const state = { schedules: [], messages: [], groups: [], logs: [], editing: null };

// Métodos que o servidor considera mutantes: exige Content-Type: application/json
// em TODOS eles, mesmo sem corpo (DELETE e POST /run não têm corpo e ainda
// assim precisam do cabeçalho, ou o servidor devolve 415).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const $ = (sel) => document.querySelector(sel);

// Escapa qualquer interpolação que vá para dentro do HTML — tanto conteúdo de
// elemento quanto, principalmente, valor de atributo (ex.: `data-id="${...}"`,
// `value="${...}"`). Um id vindo do WAHA ou digitado pelo usuário pode conter
// aspas e sinais de maior/menor; sem escapar, ele fecha o atributo e injeta
// HTML/JS arbitrário na tela (XSS). TODA interpolação dentro de um atributo
// tem que passar por aqui, sem exceção — não só a que "parece" texto livre.
const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// Rastreia se a mensagem visível em #notice é o aviso de "grupos
// indisponíveis" escrito por load(). Sem isso, qualquer notify() (inclusive
// o limpar-antes-de-agir de withErrorHandling, ou o resumo de um disparo)
// não saberia se pode apagar o que está na tela sem apagar informação de
// outra ação. Ver "IMPORTANTE 1" no relatório da revisão.
let groupsWarningActive = false;

function notify(message, type = 'error') {
  const el = $('#notice');
  el.textContent = message;
  el.className = type === 'error' ? 'error' : 'success';
  el.hidden = !message;
  groupsWarningActive = false;
}

async function api(path, init) {
  const method = (init?.method ?? 'GET').toUpperCase();
  const res = await fetch(`/api${path}`, {
    ...init,
    // Manda o cabeçalho em todo método mutante, tenha corpo ou não — o
    // servidor exige Content-Type: application/json até em DELETE e em
    // POST /run, que não têm corpo. Ver aviso da Task 9.
    headers: MUTATING_METHODS.has(method) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status} em ${path}`);
  return body;
}

async function load() {
  const [schedules, messages, logs] = await Promise.all([
    api('/schedules'),
    api('/messages'),
    api('/logs?limit=100'),
  ]);
  Object.assign(state, { schedules, messages, logs });

  // O WAHA pode estar fora do ar: a tela continua utilizável sem a lista.
  try {
    state.groups = await api('/groups');
    // Grupos voltaram: se o que está na tela ainda é o aviso de
    // indisponibilidade que ESTA função escreveu, ele já não faz sentido.
    // Se for outra coisa (ex.: o resumo de um disparo), não mexe nela.
    if (groupsWarningActive) notify('');
  } catch (err) {
    state.groups = [];
    notify(`Lista de grupos indisponível: ${err.message}. Digite os ids manualmente.`);
    groupsWarningActive = true;
  }

  render();
}

function groupName(id) {
  return state.groups.find((g) => g.id === id)?.name ?? id;
}

function renderSchedules() {
  const rows = state.schedules.map((s) => `
    <tr>
      <td>${escape(s.name)}</td>
      <td><code>${escape(s.cron)}</code></td>
      <td>${escape(state.messages.find((m) => m.id === s.messageId)?.name ?? '—')}</td>
      <td>${s.groups.length}</td>
      <td>
        <button data-action="toggle" data-id="${escape(s.id)}">${s.enabled ? 'Ativo' : 'Inativo'}</button>
      </td>
      <td class="actions">
        <button data-action="edit" data-id="${escape(s.id)}">Editar</button>
        <button data-action="run" data-id="${escape(s.id)}">Disparar agora</button>
        <button data-action="delete-schedule" data-id="${escape(s.id)}">Excluir</button>
      </td>
    </tr>`).join('');

  $('#schedules').innerHTML = `
    <button data-action="new-schedule">Novo agendamento</button>
    ${state.editing?.type === 'schedule' ? scheduleForm() : ''}
    ${state.schedules.length === 0
      ? '<p class="empty">Nenhum agendamento ainda.</p>'
      : `<table>
           <tr><th>Nome</th><th>Cron</th><th>Mensagem</th><th>Grupos</th><th>Estado</th><th></th></tr>
           ${rows}
         </table>`}`;

  // O formulário acabou de ser desenhado com o cron já preenchido: sem isto,
  // a prévia ficaria em "—" até o usuário mexer no campo.
  if (state.editing?.type === 'schedule') updatePreview(state.editing.data.cron ?? '');
}

function scheduleForm() {
  const s = state.editing.data;
  const options = state.messages
    .map((m) => `<option value="${escape(m.id)}" ${m.id === s.messageId ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');

  // Um grupo já salvo no agendamento que o WAHA não lista (o bot saiu do
  // grupo, a sessão reconectou com a lista parcial, o id foi digitado à mão)
  // continua aparecendo no formulário, marcado e sinalizado. Se ele sumisse
  // daqui, formGroups() devolveria uma lista sem ele e a API — que troca
  // lista vazia por defaultGroups — passaria a mandar a mensagem para outro
  // grupo, sem aviso nenhum, num save que só queria renomear o agendamento.
  // Destino já salvo nunca é descartado em silêncio: quem decide é o usuário.
  const saved = s.groups ?? [];
  const missing = saved.filter((id) => !state.groups.some((g) => g.id === id));

  const checkbox = (id, name, notFound) => `
        <label class="${notFound ? 'group-missing' : ''}">
          <input type="checkbox" name="group" value="${escape(id)}" ${saved.includes(id) ? 'checked' : ''} />
          ${escape(name)} <small>${escape(id)}</small>
          ${notFound ? '<small class="warn">não encontrado na lista atual do WAHA</small>' : ''}
        </label>`;

  const groupsMarkup = state.groups.length > 0
    ? [
        // Os não encontrados primeiro: é o que o usuário precisa decidir.
        ...missing.map((id) => checkbox(id, id, true)),
        ...state.groups.map((g) => checkbox(g.id, g.name, false)),
      ].join('')
    // Sem lista nenhuma do WAHA, o campo livre já vem preenchido com os ids
    // salvos — também aqui nada é perdido por o WAHA estar fora do ar.
    : `<input type="text" id="groups-text" value="${escape(saved.join(','))}"
              placeholder="ids separados por vírgula" />`;

  return `
    <form id="form-schedule">
      <label><span>Nome</span><input type="text" name="name" value="${escape(s.name ?? '')}" required /></label>
      <label><span>Cron</span><input type="text" name="cron" value="${escape(s.cron ?? '')}" required /></label>
      <p class="preview" id="preview">—</p>
      <label><span>Mensagem</span><select name="messageId" required>${options}</select></label>
      <fieldset><legend>Grupos</legend>${groupsMarkup}</fieldset>
      <button type="submit">Salvar</button>
      <button type="button" data-action="cancel">Cancelar</button>
    </form>`;
}

function renderMessages() {
  const rows = state.messages.map((m) => {
    const usedBy = state.schedules.filter((s) => s.messageId === m.id).map((s) => s.name);
    return `
      <tr>
        <td>${escape(m.name)}</td>
        <td>${escape(m.text.slice(0, 60))}${m.text.length > 60 ? '…' : ''}</td>
        <td>${usedBy.length ? escape(usedBy.join(', ')) : '<span class="empty">não usada</span>'}</td>
        <td class="actions">
          <button data-action="edit-message" data-id="${escape(m.id)}">Editar</button>
          <button data-action="delete-message" data-id="${escape(m.id)}">Excluir</button>
        </td>
      </tr>`;
  }).join('');

  const m = state.editing?.type === 'message' ? state.editing.data : null;

  $('#messages').innerHTML = `
    <button data-action="new-message">Nova mensagem</button>
    ${m ? `
      <form id="form-message">
        <label><span>Nome</span><input type="text" name="name" value="${escape(m.name ?? '')}" required /></label>
        <label><span>Texto</span><textarea name="text" required>${escape(m.text ?? '')}</textarea></label>
        <button type="submit">Salvar</button>
        <button type="button" data-action="cancel">Cancelar</button>
      </form>` : ''}
    ${state.messages.length === 0
      ? '<p class="empty">Nenhuma mensagem ainda.</p>'
      : `<table><tr><th>Nome</th><th>Texto</th><th>Usada por</th><th></th></tr>${rows}</table>`}`;
}

function renderHistory() {
  const rows = state.logs.map((l) => `
    <tr class="${l.status === 'error' ? 'error' : ''}">
      <td>${new Date(l.ts).toLocaleString('pt-BR')}</td>
      <td>${l.status === 'error' ? 'ERRO' : 'OK'}</td>
      <td>${escape(groupName(l.chatId))}</td>
      <td>${escape(l.label ?? '—')}</td>
      <td>${escape(l.error ?? l.message ?? '')}</td>
    </tr>`).join('');

  $('#history').innerHTML = state.logs.length === 0
    ? '<p class="empty">Nenhum envio registrado.</p>'
    : `<table><tr><th>Quando</th><th>Status</th><th>Grupo</th><th>Agendamento</th><th>Detalhe</th></tr>${rows}</table>`;
}

function render() {
  renderSchedules();
  renderMessages();
  renderHistory();
}

// Token da última chamada em voo: uma resposta de uma digitação antiga
// (ex.: rede lenta) não pode sobrescrever o preview de uma digitação mais
// nova — a resposta que chega fora de ordem é simplesmente descartada.
let previewToken = 0;

async function updatePreview(expr) {
  const el = $('#preview');
  if (!el) return;

  const token = ++previewToken;

  if (!expr.trim()) {
    el.textContent = '—';
    el.className = 'preview';
    return;
  }

  try {
    const { valid, next, reason } = await api(`/cron/preview?expr=${encodeURIComponent(expr)}`);
    if (token !== previewToken) return; // resposta obsoleta: já existe uma digitação mais recente.

    el.className = valid ? 'preview' : 'preview invalid';
    if (!valid) {
      // "reason" só vem quando a expressão passa na checagem estática mas o
      // node-cron recusa registrá-la (ex.: "0 0 31W 2 *"): é a única pista
      // que o usuário tem de por que aquela expressão não serve.
      el.textContent = reason ? `Expressão cron inválida: ${reason}` : 'Expressão cron inválida';
    } else if (next.length === 0) {
      el.textContent = 'Nenhum disparo previsto';
    } else {
      el.textContent = `Próximos: ${next.map((d) => new Date(d).toLocaleString('pt-BR')).join(' · ')}`;
    }
  } catch (err) {
    if (token !== previewToken) return;
    // Falha no preview não pode passar em silêncio nem deixar o horário da
    // expressão ANTERIOR parecendo válido ao lado de uma expressão nova:
    // limpa o horário obsoleto e avisa que não deu para calcular.
    el.className = 'preview invalid';
    el.textContent = `Não foi possível calcular o preview: ${err.message}`;
  }
}

function formGroups(form) {
  const text = form.querySelector('#groups-text');
  if (text) return text.value.split(',').map((g) => g.trim()).filter(Boolean);
  return [...form.querySelectorAll('input[name="group"]:checked')].map((i) => i.value);
}

async function withErrorHandling(fn) {
  // Limpa antes de agir (mensagem antiga não pode confundir uma ação nova),
  // mas note o que NÃO tem aqui: nenhum notify('') depois do await fn(). O
  // sucesso de uma ação não pode apagar a mensagem que essa mesma ação
  // acabou de escrever (ex.: o resumo de um disparo, ou o aviso de grupos
  // indisponíveis que load() re-escreveu). Ver "IMPORTANTE 1" no relatório.
  notify('');
  try {
    await fn();
  } catch (err) {
    notify(err.message);
  }
}

document.addEventListener('click', (evt) => {
  const tabButton = evt.target.closest('nav button');
  if (tabButton) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === tabButton));
    ['schedules', 'messages', 'history'].forEach((id) => {
      $(`#${id}`).hidden = id !== tabButton.dataset.tab;
    });
    return;
  }

  const target = evt.target.closest('[data-action]');
  if (!target) return;
  if (target.disabled) return;
  const { action, id } = target.dataset;

  const actions = {
    'new-schedule': () => {
      state.editing = { type: 'schedule', data: { messageId: state.messages[0]?.id, groups: [] } };
      render();
    },
    edit: () => {
      state.editing = { type: 'schedule', data: state.schedules.find((s) => s.id === id) };
      render();
    },
    'new-message': () => {
      state.editing = { type: 'message', data: {} };
      render();
    },
    'edit-message': () => {
      state.editing = { type: 'message', data: state.messages.find((m) => m.id === id) };
      render();
    },
    cancel: () => {
      state.editing = null;
      render();
    },
    toggle: () => withErrorHandling(async () => {
      const current = state.schedules.find((s) => s.id === id);
      await api(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !current.enabled }) });
      await load();
    }),
    'delete-schedule': () => withErrorHandling(async () => {
      const schedule = state.schedules.find((s) => s.id === id);
      if (!confirm(`Excluir o agendamento "${schedule.name}"?`)) return;
      await api(`/schedules/${id}`, { method: 'DELETE' });
      await load();
    }),
    'delete-message': () => withErrorHandling(async () => {
      const message = state.messages.find((m) => m.id === id);
      if (!confirm(`Excluir a mensagem "${message.name}"?`)) return;
      await api(`/messages/${id}`, { method: 'DELETE' });
      await load();
    }),
    run: () => withErrorHandling(async () => {
      const targetSchedule = state.schedules.find((s) => s.id === id);
      // Com WAHA real configurado, isto envia mensagem de verdade agora.
      const confirmText = `Enviar "${targetSchedule.name}" AGORA para ${targetSchedule.groups.length} grupo(s)?\n\n`
        + 'Isso manda mensagem de verdade no WhatsApp.';
      if (!confirm(confirmText)) return;

      // Desabilita o botão e dá retorno visual enquanto o disparo está em
      // voo: um broadcast com vários grupos e delay entre eles pode demorar
      // dezenas de segundos, e sem isso um clique impaciente manda duas
      // vezes. Fila e retry são proibidos no projeto — a defesa é da tela.
      const originalText = target.textContent;
      target.disabled = true;
      target.textContent = 'Enviando…';
      try {
        const { sent, failed } = await api(`/schedules/${id}/run`, { method: 'POST' });
        notify(`Disparo concluído: ${sent} enviada(s), ${failed} falha(s).`, 'ok');
        await load();
      } finally {
        // Em sucesso, load() já substituiu a linha (botão novo, habilitado).
        // Em erro, o botão original continua no DOM e precisa ser reabilitado.
        if (target.isConnected) {
          target.disabled = false;
          target.textContent = originalText;
        }
      }
    }),
  };

  actions[action]?.();
});

document.addEventListener('input', (evt) => {
  if (evt.target.name === 'cron') updatePreview(evt.target.value);
});

document.addEventListener('submit', (evt) => {
  evt.preventDefault();
  const form = evt.target;

  withErrorHandling(async () => {
    if (form.id === 'form-schedule') {
      const groups = formGroups(form);
      // A API recusa lista vazia com 400. Barrar aqui evita a ida e volta e
      // deixa claro que desmarcar tudo não significa "herda os defaults".
      if (groups.length === 0) {
        throw new Error('Selecione ao menos um grupo de destino.');
      }

      const payload = {
        name: form.name.value,
        cron: form.cron.value,
        messageId: form.messageId.value,
        groups,
      };
      const editingId = state.editing.data.id;
      await api(editingId ? `/schedules/${editingId}` : '/schedules', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(editingId ? { ...payload, enabled: state.editing.data.enabled } : payload),
      });
    } else {
      const payload = { name: form.name.value, text: form.text.value };
      const editingId = state.editing.data.id;
      await api(editingId ? `/messages/${editingId}` : '/messages', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
    }

    state.editing = null;
    await load();
  });
});

load().catch((err) => notify(err.message));
