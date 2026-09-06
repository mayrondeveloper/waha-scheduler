// Tela de agendamentos: busca o estado da API e redesenha a cada alteração.

const estado = { schedules: [], messages: [], groups: [], logs: [], editando: null };

// Métodos que o servidor considera mutantes: exige Content-Type: application/json
// em TODOS eles, mesmo sem corpo (DELETE e POST /run não têm corpo e ainda
// assim precisam do cabeçalho, ou o servidor devolve 415).
const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const $ = (sel) => document.querySelector(sel);
const escape = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function avisar(mensagem, tipo = 'erro') {
  const el = $('#aviso');
  el.textContent = mensagem;
  el.className = tipo === 'erro' ? 'falha' : 'sucesso';
  el.hidden = !mensagem;
}

async function api(caminho, init) {
  const metodo = (init?.method ?? 'GET').toUpperCase();
  const res = await fetch(`/api${caminho}`, {
    ...init,
    // Manda o cabeçalho em todo método mutante, tenha corpo ou não — o
    // servidor exige Content-Type: application/json até em DELETE e em
    // POST /run, que não têm corpo. Ver aviso da Task 9.
    headers: METODOS_MUTANTES.has(metodo) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error ?? `Erro ${res.status} em ${caminho}`);
  return corpo;
}

async function carregar() {
  avisar('');
  const [schedules, messages, logs] = await Promise.all([
    api('/schedules'),
    api('/messages'),
    api('/logs?limit=100'),
  ]);
  Object.assign(estado, { schedules, messages, logs });

  // O WAHA pode estar fora do ar: a tela continua utilizável sem a lista.
  try {
    estado.groups = await api('/groups');
  } catch (err) {
    estado.groups = [];
    avisar(`Lista de grupos indisponível: ${err.message}. Digite os ids manualmente.`);
  }

  desenhar();
}

function nomeDoGrupo(id) {
  return estado.groups.find((g) => g.id === id)?.name ?? id;
}

function desenharAgendamentos() {
  const linhas = estado.schedules.map((s) => `
    <tr>
      <td>${escape(s.name)}</td>
      <td><code>${escape(s.cron)}</code></td>
      <td>${escape(estado.messages.find((m) => m.id === s.messageId)?.name ?? '—')}</td>
      <td>${s.groups.length}</td>
      <td>
        <button data-acao="toggle" data-id="${s.id}">${s.enabled ? 'Ativo' : 'Inativo'}</button>
      </td>
      <td class="acoes">
        <button data-acao="editar" data-id="${s.id}">Editar</button>
        <button data-acao="disparar" data-id="${s.id}">Disparar agora</button>
        <button data-acao="excluir-sch" data-id="${s.id}">Excluir</button>
      </td>
    </tr>`).join('');

  $('#agendamentos').innerHTML = `
    <button data-acao="novo-sch">Novo agendamento</button>
    ${estado.editando?.tipo === 'schedule' ? formularioAgendamento() : ''}
    ${estado.schedules.length === 0
      ? '<p class="vazio">Nenhum agendamento ainda.</p>'
      : `<table>
           <tr><th>Nome</th><th>Cron</th><th>Mensagem</th><th>Grupos</th><th>Estado</th><th></th></tr>
           ${linhas}
         </table>`}`;
}

function formularioAgendamento() {
  const s = estado.editando.dados;
  const opcoes = estado.messages
    .map((m) => `<option value="${m.id}" ${m.id === s.messageId ? 'selected' : ''}>${escape(m.name)}</option>`)
    .join('');

  const grupos = estado.groups.length > 0
    ? estado.groups.map((g) => `
        <label>
          <input type="checkbox" name="grupo" value="${g.id}" ${s.groups?.includes(g.id) ? 'checked' : ''} />
          ${escape(g.name)} <small>${escape(g.id)}</small>
        </label>`).join('')
    : `<input type="text" id="grupos-texto" value="${escape((s.groups ?? []).join(','))}"
              placeholder="ids separados por vírgula" />`;

  return `
    <form id="form-sch">
      <label><span>Nome</span><input type="text" name="name" value="${escape(s.name ?? '')}" required /></label>
      <label><span>Cron</span><input type="text" name="cron" value="${escape(s.cron ?? '')}" required /></label>
      <p class="preview" id="preview">—</p>
      <label><span>Mensagem</span><select name="messageId" required>${opcoes}</select></label>
      <fieldset><legend>Grupos</legend>${grupos}</fieldset>
      <button type="submit">Salvar</button>
      <button type="button" data-acao="cancelar">Cancelar</button>
    </form>`;
}

function desenharMensagens() {
  const linhas = estado.messages.map((m) => {
    const usos = estado.schedules.filter((s) => s.messageId === m.id).map((s) => s.name);
    return `
      <tr>
        <td>${escape(m.name)}</td>
        <td>${escape(m.text.slice(0, 60))}${m.text.length > 60 ? '…' : ''}</td>
        <td>${usos.length ? escape(usos.join(', ')) : '<span class="vazio">não usada</span>'}</td>
        <td class="acoes">
          <button data-acao="editar-msg" data-id="${m.id}">Editar</button>
          <button data-acao="excluir-msg" data-id="${m.id}">Excluir</button>
        </td>
      </tr>`;
  }).join('');

  const m = estado.editando?.tipo === 'message' ? estado.editando.dados : null;

  $('#mensagens').innerHTML = `
    <button data-acao="nova-msg">Nova mensagem</button>
    ${m ? `
      <form id="form-msg">
        <label><span>Nome</span><input type="text" name="name" value="${escape(m.name ?? '')}" required /></label>
        <label><span>Texto</span><textarea name="text" required>${escape(m.text ?? '')}</textarea></label>
        <button type="submit">Salvar</button>
        <button type="button" data-acao="cancelar">Cancelar</button>
      </form>` : ''}
    ${estado.messages.length === 0
      ? '<p class="vazio">Nenhuma mensagem ainda.</p>'
      : `<table><tr><th>Nome</th><th>Texto</th><th>Usada por</th><th></th></tr>${linhas}</table>`}`;
}

function desenharHistorico() {
  const linhas = estado.logs.map((l) => `
    <tr class="${l.status === 'error' ? 'falha' : ''}">
      <td>${new Date(l.ts).toLocaleString('pt-BR')}</td>
      <td>${l.status === 'error' ? 'ERRO' : 'OK'}</td>
      <td>${escape(nomeDoGrupo(l.chatId))}</td>
      <td>${escape(l.label ?? '—')}</td>
      <td>${escape(l.error ?? l.message ?? '')}</td>
    </tr>`).join('');

  $('#historico').innerHTML = estado.logs.length === 0
    ? '<p class="vazio">Nenhum envio registrado.</p>'
    : `<table><tr><th>Quando</th><th>Status</th><th>Grupo</th><th>Agendamento</th><th>Detalhe</th></tr>${linhas}</table>`;
}

function desenhar() {
  desenharAgendamentos();
  desenharMensagens();
  desenharHistorico();
}

async function atualizarPreview(expr) {
  const el = $('#preview');
  if (!el) return;

  if (!expr.trim()) {
    el.textContent = '—';
    el.className = 'preview';
    return;
  }

  const { valid, next } = await api(`/cron/preview?expr=${encodeURIComponent(expr)}`);
  el.className = valid ? 'preview' : 'preview invalido';
  if (!valid) {
    el.textContent = 'Expressão cron inválida';
  } else if (next.length === 0) {
    el.textContent = 'Nenhum disparo previsto';
  } else {
    el.textContent = `Próximos: ${next.map((d) => new Date(d).toLocaleString('pt-BR')).join(' · ')}`;
  }
}

function gruposDoFormulario(form) {
  const texto = form.querySelector('#grupos-texto');
  if (texto) return texto.value.split(',').map((g) => g.trim()).filter(Boolean);
  return [...form.querySelectorAll('input[name="grupo"]:checked')].map((i) => i.value);
}

async function comErro(fn) {
  try {
    await fn();
    avisar('');
  } catch (err) {
    avisar(err.message);
  }
}

document.addEventListener('click', (evento) => {
  const aba = evento.target.closest('nav button');
  if (aba) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('ativa', b === aba));
    ['agendamentos', 'mensagens', 'historico'].forEach((id) => {
      $(`#${id}`).hidden = id !== aba.dataset.aba;
    });
    return;
  }

  const alvo = evento.target.closest('[data-acao]');
  if (!alvo) return;
  if (alvo.disabled) return;
  const { acao, id } = alvo.dataset;

  const acoes = {
    'novo-sch': () => {
      estado.editando = { tipo: 'schedule', dados: { messageId: estado.messages[0]?.id, groups: [] } };
      desenhar();
    },
    editar: () => {
      estado.editando = { tipo: 'schedule', dados: estado.schedules.find((s) => s.id === id) };
      desenhar();
    },
    'nova-msg': () => {
      estado.editando = { tipo: 'message', dados: {} };
      desenhar();
    },
    'editar-msg': () => {
      estado.editando = { tipo: 'message', dados: estado.messages.find((m) => m.id === id) };
      desenhar();
    },
    cancelar: () => {
      estado.editando = null;
      desenhar();
    },
    toggle: () => comErro(async () => {
      const atual = estado.schedules.find((s) => s.id === id);
      await api(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !atual.enabled }) });
      await carregar();
    }),
    'excluir-sch': () => comErro(async () => {
      const alvo = estado.schedules.find((s) => s.id === id);
      if (!confirm(`Excluir o agendamento "${alvo.name}"?`)) return;
      await api(`/schedules/${id}`, { method: 'DELETE' });
      await carregar();
    }),
    'excluir-msg': () => comErro(async () => {
      const alvo = estado.messages.find((m) => m.id === id);
      if (!confirm(`Excluir a mensagem "${alvo.name}"?`)) return;
      await api(`/messages/${id}`, { method: 'DELETE' });
      await carregar();
    }),
    disparar: () => comErro(async () => {
      const alvoAgendamento = estado.schedules.find((s) => s.id === id);
      // Com WAHA real configurado, isto envia mensagem de verdade agora.
      const texto = `Enviar "${alvoAgendamento.name}" AGORA para ${alvoAgendamento.groups.length} grupo(s)?\n\n`
        + 'Isso manda mensagem de verdade no WhatsApp.';
      if (!confirm(texto)) return;

      // Desabilita o botão e dá retorno visual enquanto o disparo está em
      // voo: um broadcast com vários grupos e delay entre eles pode demorar
      // dezenas de segundos, e sem isso um clique impaciente manda duas
      // vezes. Fila e retry são proibidos no projeto — a defesa é da tela.
      const textoOriginal = alvo.textContent;
      alvo.disabled = true;
      alvo.textContent = 'Enviando…';
      try {
        const { sent, failed } = await api(`/schedules/${id}/run`, { method: 'POST' });
        avisar(`Disparo concluído: ${sent} enviada(s), ${failed} falha(s).`, 'ok');
        await carregar();
      } finally {
        // Em sucesso, carregar() já substituiu a linha (botão novo, habilitado).
        // Em erro, o botão original continua no DOM e precisa ser reabilitado.
        if (alvo.isConnected) {
          alvo.disabled = false;
          alvo.textContent = textoOriginal;
        }
      }
    }),
  };

  acoes[acao]?.();
});

document.addEventListener('input', (evento) => {
  if (evento.target.name === 'cron') atualizarPreview(evento.target.value).catch(() => {});
});

document.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const form = evento.target;

  comErro(async () => {
    if (form.id === 'form-sch') {
      const dados = {
        name: form.name.value,
        cron: form.cron.value,
        messageId: form.messageId.value,
        groups: gruposDoFormulario(form),
      };
      const editandoId = estado.editando.dados.id;
      await api(editandoId ? `/schedules/${editandoId}` : '/schedules', {
        method: editandoId ? 'PUT' : 'POST',
        body: JSON.stringify(editandoId ? { ...dados, enabled: estado.editando.dados.enabled } : dados),
      });
    } else {
      const dados = { name: form.name.value, text: form.text.value };
      const editandoId = estado.editando.dados.id;
      await api(editandoId ? `/messages/${editandoId}` : '/messages', {
        method: editandoId ? 'PUT' : 'POST',
        body: JSON.stringify(dados),
      });
    }

    estado.editando = null;
    await carregar();
  });
});

carregar().catch((err) => avisar(err.message));
