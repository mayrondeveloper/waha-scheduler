// Rotas de apoio da tela: grupos do WAHA, histórico e disparo imediato.

import { readFileSync, existsSync } from 'node:fs';
import { schedule as scheduleCron } from 'node-cron';
import { readStore } from '../store.js';
import { checkCron } from '../../schedules.js';
import { listGroups } from '../../waha/client.js';
import { broadcast } from '../../broadcast.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Rotas de grupos, histórico e disparo imediato, no formato consumido por createServer.
 * @type {Record<string, (ctx: object) => Promise<{status?: number, body: unknown}>>}
 */
export const actionRoutes = {
  'GET /api/groups': async ({ cfg }) => {
    try {
      return { body: await listGroups(cfg) };
    } catch (err) {
      // O WAHA estar fora do ar não é erro nosso: 502 e a tela segue utilizável
      // sem a lista de grupos (o resto da API continua respondendo normalmente).
      throw httpError(502, err.message);
    }
  },

  'GET /api/logs': async ({ url, cfg }) => {
    if (!existsSync(cfg.logPath)) return { body: [] };

    const requested = Number(url.searchParams.get('limit'));
    const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 100, 1000);

    let raw;
    try {
      raw = readFileSync(cfg.logPath, 'utf8');
    } catch (err) {
      throw httpError(500, `Não foi possível ler o histórico em ${cfg.logPath}: ${err.message}`);
    }

    const lines = raw.trim().split('\n').filter(Boolean);

    // Uma linha corrompida no meio do arquivo não pode derrubar a leitura:
    // ela só é descartada, o resto do histórico continua disponível.
    const entries = lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();

    return { body: entries };
  },

  'POST /api/schedules/:id/run': async ({ params, schedulesPath, cfg }) => {
    const store = readStore(schedulesPath);

    const schedule = store.schedules.find((s) => s.id === params.id);
    if (!schedule) throw httpError(404, `Agendamento "${params.id}" não encontrado.`);

    const message = store.messages.find((m) => m.id === schedule.messageId);
    if (!message) throw httpError(404, `Mensagem "${schedule.messageId}" não encontrada.`);

    const { sent, failed, results } = await broadcast(message.text, schedule.groups, {
      cfg,
      label: `${schedule.name} (manual)`,
    });

    return { body: { sent, failed, results } };
  },

  'GET /api/cron/preview': async ({ url, cfg }) => {
    const expr = url.searchParams.get('expr') ?? '';

    // Mesma checagem que a gravação faz: uma expressão que o node-cron
    // recusa registrar aparece aqui como inválida, com o motivo, em vez de
    // estourar um 500 sem causa bem onde o usuário precisa entender o erro.
    const check = checkCron(expr, cfg.timezone);
    if (!check.valid) return { body: { valid: false, next: [], reason: check.reason } };

    // Cria a task só para consultar os próximos disparos e a destrói em
    // seguida. O fuso é o MESMO com que o scheduler registra: sem ele, num
    // VPS em UTC com TIMEZONE=America/Sao_Paulo, os "próximos disparos"
    // sairiam errados pelo offset inteiro.
    const task = scheduleCron(expr, () => {}, { timezone: cfg.timezone });
    try {
      const next = task.getNextRuns(3).map((d) => new Date(d).toISOString());
      return { body: { valid: true, next } };
    } finally {
      task.destroy();
    }
  },
};
