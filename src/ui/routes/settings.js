// Rotas HTTP dos ajustes (pausa geral, janela de silêncio, limite por hora,
// alertas).

import { readStore, updateStore } from '../../store.js';
import { validateSettings } from '../../schedules.js';

// Erro de validação é motivo de negócio (400), não o 500 genérico do servidor.
function parseSettings(raw) {
  try {
    return validateSettings(raw);
  } catch (err) {
    err.status = 400;
    throw err;
  }
}

/**
 * Rotas dos ajustes, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const settingsRoutes = {
  'GET /api/settings': async ({ schedulesPath }) => ({
    body: readStore(schedulesPath).settings,
  }),

  // O objeto inteiro de uma vez: a aba Ajustes salva tudo junto, e um campo
  // ausente volta ao padrão.
  'PUT /api/settings': async ({ body, schedulesPath }) => {
    const settings = parseSettings(body);
    const saved = await updateStore(schedulesPath, (store) => {
      store.settings = settings;
      return store;
    });
    return { body: saved.settings };
  },
};
