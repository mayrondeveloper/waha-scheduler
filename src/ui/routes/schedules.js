// Rotas HTTP dos agendamentos.

import { readStore, updateStore } from '../../store.js';
import { validateSchedule } from '../../schedules.js';
import { wallToInstant } from '../../dates.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function contextOf(store) {
  return {
    defaultGroups: store.defaultGroups,
    messageIds: new Set(store.messages.map((m) => m.id)),
    listIds: new Set(store.groupLists.map((l) => l.id)),
  };
}

// Só os campos que o cliente pode escolher: id, firedAt e missedAt são do
// servidor.
function fieldsOf(body) {
  return {
    name: body.name, cron: body.cron, at: body.at, messageId: body.messageId,
    groups: body.groups, groupLists: body.groupLists, enabled: body.enabled,
  };
}

// Um envio único marcado para o passado nunca sairia (ou sairia "perdido"
// no tique seguinte): melhor recusar já, com o que o usuário precisa mudar.
function assertFuture(schedule, cfg) {
  if (schedule.at && wallToInstant(schedule.at, cfg.timezone) <= Date.now()) {
    throw httpError(400, 'Escolha um horário no futuro para o envio único.');
  }
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

  'POST /api/schedules': async ({ body, schedulesPath, cfg }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      // id sempre gerado no servidor: o cliente não escolhe identidade.
      created = parseSchedule(fieldsOf(body), contextOf(store));
      assertFuture(created, cfg);
      assertUniqueName(store.schedules, created.name, created.id);
      store.schedules.push(created);
      return store;
    });
    return { status: 201, body: saved.schedules.find((s) => s.id === created.id) };
  },

  'PUT /api/schedules/:id': async ({ body, params, schedulesPath, cfg }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.schedules.findIndex((s) => s.id === params.id);
      if (index === -1) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);
      const current = store.schedules[index];

      // id sempre preservado da URL: o corpo pode mandar outro, é ignorado.
      // O resultado de um envio único (firedAt/missedAt) fica enquanto o
      // horário for o mesmo; um horário novo reativa o envio.
      const sameAt = Boolean(body.at) && body.at === current.at;
      const updated = parseSchedule(
        { id: params.id, ...fieldsOf(body), ...(sameAt && { firedAt: current.firedAt, missedAt: current.missedAt }) },
        contextOf(store)
      );
      if (!sameAt) assertFuture(updated, cfg);
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
