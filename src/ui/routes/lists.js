// Rotas HTTP das listas de grupos.

import { readStore, updateStore } from '../../store.js';
import { validateGroupList } from '../../schedules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Erro de validação é motivo de negócio (400), não o 500 genérico do servidor.
function parseList(raw) {
  try {
    return validateGroupList(raw);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}

function assertUniqueName(lists, name, excludeId) {
  if (lists.some((l) => l.name === name && l.id !== excludeId)) {
    throw httpError(409, `Lista "${name}": nome duplicado.`);
  }
}

/**
 * Rotas das listas de grupos, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const listRoutes = {
  'GET /api/lists': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).groupLists,
  }),

  'POST /api/lists': async ({ body, schedulesPath }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      // id sempre gerado no servidor: o cliente não escolhe identidade.
      created = parseList({ name: body.name, groups: body.groups });
      assertUniqueName(store.groupLists, created.name, created.id);
      store.groupLists.push(created);
      return store;
    });
    return { status: 201, body: saved.groupLists.find((l) => l.id === created.id) };
  },

  'PUT /api/lists/:id': async ({ body, params, schedulesPath }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.groupLists.findIndex((l) => l.id === params.id);
      if (index === -1) throw httpError(404, `Lista "${params.id}" não encontrada.`);

      const updated = parseList({ id: params.id, name: body.name, groups: body.groups });
      assertUniqueName(store.groupLists, updated.name, params.id);
      store.groupLists[index] = updated;
      return store;
    });
    return { body: saved.groupLists.find((l) => l.id === params.id) };
  },

  'DELETE /api/lists/:id': async ({ params, schedulesPath }) => {
    await updateStore(schedulesPath, (store) => {
      const index = store.groupLists.findIndex((l) => l.id === params.id);
      if (index === -1) throw httpError(404, `Lista "${params.id}" não encontrada.`);

      // Apagar uma lista em uso deixaria agendamentos sem destino: a leitura
      // do arquivo recusaria o store inteiro. Recusar aqui, nomeando quem
      // usa, é o que o usuário precisa para decidir.
      const users = store.schedules.filter((s) => (s.groupLists ?? []).includes(params.id)).map((s) => s.name);
      if (users.length > 0) {
        throw httpError(409, `A lista "${store.groupLists[index].name}" é usada por: ${users.join(', ')}. Tire-a desses agendamentos antes de excluir.`);
      }
      store.groupLists.splice(index, 1);
      return store;
    });
    return { body: { ok: true } };
  },
};
