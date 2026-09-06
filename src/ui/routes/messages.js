// Rotas HTTP da biblioteca de mensagens.

import { readStore, updateStore } from '../store.js';
import { validateMessage } from '../../schedules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// validateMessage lança Error de validação sem "status" (motivo de negócio,
// não de transporte). O catch de server.js devolve mensagem genérica para
// qualquer status >= 500 ("nunca vazar caminho de arquivo"); sem marcar 400
// aqui, um erro de validação cairia nesse >= 500 padrão e o usuário veria
// "Erro interno do servidor" em vez do que precisa corrigir no formulário.
function parseMessage(raw) {
  try {
    return validateMessage(raw);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}

/**
 * Rotas da biblioteca de mensagens, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const messageRoutes = {
  'GET /api/messages': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).messages,
  }),

  'POST /api/messages': async ({ body, schedulesPath }) => {
    let created;
    const saved = await updateStore(schedulesPath, (store) => {
      // id sempre gerado no servidor: o cliente não escolhe identidade.
      created = parseMessage({ name: body.name, text: body.text });
      store.messages.push(created);
      return store;
    });
    return { status: 201, body: saved.messages.find((m) => m.id === created.id) };
  },

  'PUT /api/messages/:id': async ({ body, params, schedulesPath }) => {
    const saved = await updateStore(schedulesPath, (store) => {
      const index = store.messages.findIndex((m) => m.id === params.id);
      if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

      store.messages[index] = parseMessage({
        id: params.id,
        name: body.name,
        text: body.text,
      });
      return store;
    });
    return { body: saved.messages.find((m) => m.id === params.id) };
  },

  'DELETE /api/messages/:id': async ({ params, schedulesPath }) => {
    await updateStore(schedulesPath, (store) => {
      const index = store.messages.findIndex((m) => m.id === params.id);
      if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

      // Nunca excluir em cascata: um agendamento apontando para uma
      // mensagem apagada dispararia em silêncio com texto inexistente.
      const emUso = store.schedules.filter((s) => s.messageId === params.id).map((s) => s.name);
      if (emUso.length > 0) {
        throw httpError(
          409,
          `Mensagem em uso por: ${emUso.join(', ')}. Desvincule antes de excluir.`
        );
      }

      store.messages.splice(index, 1);
      return store;
    });
    return { body: { ok: true } };
  },
};
