// Rotas HTTP da biblioteca de mensagens, com o anexo de cada uma.

import { readFileSync } from 'node:fs';
import { readStore, updateStore } from '../../store.js';
import { validateMessage } from '../../schedules.js';
import { MAX_MEDIA_BYTES, mediaDirFor, mediaPath, saveMedia, removeMedia } from '../../media.js';

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

// O README promete "name" único entre mensagens, mas nada verificava isso:
// normalizeStore só confere id duplicado. Duas mensagens com o mesmo nome e
// textos diferentes viram duas opções idênticas no <select> do formulário de
// agendamento — o usuário escolhe a errada e o grupo recebe o texto errado.
// Mesmo padrão de assertUniqueName dos agendamentos (src/ui/routes/schedules.js),
// inclusive o cuidado de não acusar um registro de ser duplicata de si mesmo
// ao editar.
function assertUniqueName(messages, name, excludeId) {
  const isDuplicate = messages.some((m) => m.name === name && m.id !== excludeId);
  if (isDuplicate) {
    throw httpError(400, `Mensagem "${name}": nome duplicado.`);
  }
}

// O "media" do corpo é um upload novo ({ filename, mimetype, data }), a
// referência ao atual ({ id }) ou nada (sem anexo). Devolve o que gravar na
// mensagem, o arquivo recém-gravado (para desfazer se a gravação falhar) e
// o obsoleto (para apagar depois que a gravação der certo).
function resolveMedia(body, current, dir, cfg) {
  const incoming = body.media;
  if (incoming == null) return { media: null, saved: null, obsolete: current };
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw httpError(400, 'Campo "media" deve ser um objeto.');
  }
  if (incoming.data === undefined) {
    if (!current || incoming.id !== current.id) {
      throw httpError(400, `Anexo "${incoming.id}" não é o anexo atual desta mensagem.`);
    }
    return { media: current, saved: null, obsolete: null };
  }
  let saved;
  try {
    saved = saveMedia(dir, incoming, { maxBytes: cfg.maxMediaBytes ?? MAX_MEDIA_BYTES });
  } catch (err) {
    throw httpError(400, err.message);
  }
  return { media: saved, saved, obsolete: current };
}

/**
 * Rotas da biblioteca de mensagens e do arquivo dos anexos, no formato
 * consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body?: unknown, raw?: Buffer}>>}
 */
export const messageRoutes = {
  'GET /api/messages': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).messages,
  }),

  'POST /api/messages': async ({ body, schedulesPath, cfg }) => {
    const dir = mediaDirFor(schedulesPath);
    const { media, saved } = resolveMedia(body, null, dir, cfg);
    let created;
    let store;
    try {
      store = await updateStore(schedulesPath, (s) => {
        // id sempre gerado no servidor: o cliente não escolhe identidade.
        created = parseMessage({ name: body.name, text: body.text, ...(media && { media }) });
        assertUniqueName(s.messages, created.name, created.id);
        s.messages.push(created);
        return s;
      });
    } catch (err) {
      // O arquivo foi gravado antes de a mensagem ser recusada: não pode sobrar.
      if (saved) removeMedia(dir, saved);
      throw err;
    }
    return { status: 201, body: store.messages.find((m) => m.id === created.id) };
  },

  'PUT /api/messages/:id': async ({ body, params, schedulesPath, cfg }) => {
    const dir = mediaDirFor(schedulesPath);
    const current = readStore(schedulesPath).messages.find((m) => m.id === params.id);
    if (!current) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

    const { media, saved, obsolete } = resolveMedia(body, current.media ?? null, dir, cfg);
    let store;
    try {
      store = await updateStore(schedulesPath, (s) => {
        const index = s.messages.findIndex((m) => m.id === params.id);
        if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

        // id sempre preservado da URL: o corpo pode mandar outro, é ignorado.
        const updated = parseMessage({ id: params.id, name: body.name, text: body.text, ...(media && { media }) });
        assertUniqueName(s.messages, updated.name, params.id);
        s.messages[index] = updated;
        return s;
      });
    } catch (err) {
      if (saved) removeMedia(dir, saved);
      throw err;
    }
    // Só depois de gravar: se a gravação falhasse, o anexo antigo ainda seria o certo.
    if (obsolete) removeMedia(dir, obsolete);
    return { body: store.messages.find((m) => m.id === params.id) };
  },

  'DELETE /api/messages/:id': async ({ params, schedulesPath }) => {
    let removed;
    await updateStore(schedulesPath, (store) => {
      const index = store.messages.findIndex((m) => m.id === params.id);
      if (index === -1) throw httpError(404, `Mensagem "${params.id}" não encontrada.`);

      // Nunca excluir em cascata: um agendamento apontando para uma
      // mensagem apagada dispararia em silêncio com texto inexistente.
      const usedBy = store.schedules.filter((s) => s.messageId === params.id).map((s) => s.name);
      if (usedBy.length > 0) {
        throw httpError(
          409,
          `Mensagem em uso por: ${usedBy.join(', ')}. Desvincule antes de excluir.`
        );
      }

      [removed] = store.messages.splice(index, 1);
      return store;
    });
    if (removed?.media) removeMedia(mediaDirFor(schedulesPath), removed.media);
    return { body: { ok: true } };
  },

  // O arquivo é achado pelo id na biblioteca e aberto pelo caminho gravado:
  // nada da URL vira caminho.
  'GET /api/media/:id': async ({ params, schedulesPath }) => {
    const message = readStore(schedulesPath).messages.find((m) => m.media?.id === params.id);
    if (!message) throw httpError(404, `Anexo "${params.id}" não encontrado.`);

    let raw;
    try {
      raw = readFileSync(mediaPath(mediaDirFor(schedulesPath), message.media));
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw httpError(404, `O arquivo do anexo "${message.media.filename}" não está mais no disco.`);
      }
      throw err;
    }
    return {
      raw,
      contentType: message.media.mimetype,
      headers: {
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(message.media.filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    };
  },
};
