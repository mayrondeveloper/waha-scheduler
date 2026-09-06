// Rotas HTTP dos agendamentos.

import { readStore, updateStore } from '../store.js';
import { validateSchedule } from '../../schedules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function messageIdsOf(store) {
  return new Set(store.messages.map((m) => m.id));
}

// validateSchedule lança Error de validação sem "status" (motivo de negócio,
// não de transporte). O catch de server.js devolve mensagem genérica para
// qualquer status >= 500 ("nunca vazar caminho de arquivo"); sem marcar 400
// aqui, um erro de validação (cron inválido, messageId inexistente, ...)
// cairia nesse >= 500 padrão e o usuário veria "Erro interno do servidor" em
// vez do que precisa corrigir no formulário.
function parseSchedule(raw, context) {
  try {
    return validateSchedule(raw, context);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}

// validateSchedule valida um agendamento isolado; nome duplicado só é
// detectado quando o store inteiro é revalidado (normalizeStore, dentro de
// updateStore, DEPOIS que o mutator já devolveu o store). Um erro ali chega
// sem "status" e cairia no 500 genérico. Checar aqui, antes de gravar, dá o
// 400 com o texto certo e evita a escrita.
function assertUniqueName(schedules, name, excludeId) {
  const isDuplicate = schedules.some((s) => s.name === name && s.id !== excludeId);
  if (isDuplicate) {
    throw httpError(400, `Agendamento "${name}": nome duplicado.`);
  }
}

/**
 * Rotas dos agendamentos, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const scheduleRoutes = {
  'GET /api/schedules': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).schedules,
  }),

  'POST /api/schedules': async ({ body, schedulesPath }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      // id sempre gerado no servidor: o cliente não escolhe identidade.
      created = parseSchedule(
        { name: body.name, cron: body.cron, messageId: body.messageId, groups: body.groups, enabled: body.enabled },
        { defaultGroups: store.defaultGroups, messageIds: messageIdsOf(store) }
      );
      assertUniqueName(store.schedules, created.name, created.id);
      store.schedules.push(created);
      return store;
    });
    return { status: 201, body: saved.schedules.find((s) => s.id === created.id) };
  },

  'PUT /api/schedules/:id': async ({ body, params, schedulesPath }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.schedules.findIndex((s) => s.id === params.id);
      if (index === -1) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      // id sempre preservado da URL: o corpo pode mandar outro, é ignorado.
      const updated = parseSchedule(
        { id: params.id, name: body.name, cron: body.cron, messageId: body.messageId, groups: body.groups, enabled: body.enabled },
        { defaultGroups: store.defaultGroups, messageIds: messageIdsOf(store) }
      );
      assertUniqueName(store.schedules, updated.name, params.id);
      store.schedules[index] = updated;
      return store;
    });
    return { body: saved.schedules.find((s) => s.id === params.id) };
  },

  'PATCH /api/schedules/:id': async ({ body, params, schedulesPath }) => {
    // PATCH altera só "enabled": qualquer outro campo no corpo é ignorado, e
    // corpo sem "enabled" booleano é rejeitado antes de tocar o arquivo.
    if (typeof body.enabled !== 'boolean') {
      throw httpError(400, 'PATCH aceita apenas o campo "enabled" (true ou false).');
    }

    const saved = await updateStore(schedulesPath, (store) => {
      const current = store.schedules.find((s) => s.id === params.id);
      if (!current) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      current.enabled = body.enabled;
      return store;
    });
    return { body: saved.schedules.find((s) => s.id === params.id) };
  },

  'DELETE /api/schedules/:id': async ({ params, schedulesPath }) => {
    await updateStore(schedulesPath, (store) => {
      const index = store.schedules.findIndex((s) => s.id === params.id);
      if (index === -1) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

      store.schedules.splice(index, 1);
      return store;
    });
    return { body: { ok: true } };
  },
};
