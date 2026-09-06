// Leitura e validação do arquivo de agendamentos (schedules.json).

import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { schedule as scheduleCron, validate as isValidCron } from 'node-cron';
import { config } from './config.js';
import { normalizeGroups } from './broadcast.js';

function fail(message) {
  throw new Error(message);
}

function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function stableId(prefix, seed) {
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

function labelFor(raw, index) {
  if (raw && typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim();
  return index != null ? `#${index + 1}` : '(sem nome)';
}

/**
 * Confere se a expressão cron é registrável de fato, e não apenas
 * bem-formada: validate() aceita expressões que schedule() recusa — por
 * exemplo "0 0 31W 2 *", que passa na checagem estática mas nunca casa com
 * data nenhuma. Sem isto, a tela grava um cron que a recarga do scheduler
 * ignora em silêncio e que faz o PRÓXIMO boot abortar, deixando o usuário
 * com um arquivo para consertar na mão — exatamente o que a tela existe
 * para evitar.
 * @param {string} expr Expressão cron.
 * @param {string} [timezone] Fuso com que a expressão será registrada
 *   (default: config.timezone) — é o mesmo que o scheduler usa.
 * @returns {{valid: boolean, reason?: string}} "reason" só vem quando a
 *   expressão é bem-formada mas o node-cron recusa registrá-la.
 */
export function checkCron(expr, timezone = config.timezone) {
  if (typeof expr !== 'string' || !isValidCron(expr)) return { valid: false };

  // Cria e destrói na hora, como a rota de preview: uma validação não pode
  // deixar task pendurada no registro global do node-cron.
  let task;
  try {
    task = scheduleCron(expr, () => {}, { timezone });
  } catch (err) {
    return { valid: false, reason: err.message };
  }
  task.destroy();
  return { valid: true };
}

/**
 * Valida e normaliza uma mensagem da biblioteca.
 * @param {Record<string, unknown>} raw Mensagem crua.
 * @param {number} [index] Posição no array "messages" (rotula erros sem nome como #1, #2, ...).
 * @returns {{id: string, name: string, text: string}}
 */
export function validateMessage(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Mensagem: cada item de "messages" deve ser um objeto.');
  }
  const label = labelFor(raw, index);

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Mensagem ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (typeof raw.text !== 'string' || !raw.text.trim()) {
    fail(`Mensagem "${label}": campo "text" é obrigatório e deve ser um texto.`);
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
    fail(`Mensagem "${label}": campo "id" deve ser um texto.`);
  }

  return {
    id: raw.id?.trim() || newId('msg'),
    name: raw.name.trim(),
    text: raw.text,
  };
}

/**
 * Valida e normaliza um agendamento.
 * @param {Record<string, unknown>} raw Agendamento cru.
 * @param {{defaultGroups?: string[], messageIds?: Set<string>}} [context]
 *   messageIds: ids válidos da biblioteca; quando informado, "messageId" é conferido.
 * @param {number} [index] Posição no array "schedules" (rotula erros sem nome como #1, #2, ...).
 * @returns {{id: string, name: string, cron: string, messageId: string, groups: string[], enabled: boolean}}
 */
export function validateSchedule(raw, context = {}, index) {
  const { defaultGroups = [], messageIds = null } = context;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Agendamento: cada item de "schedules" deve ser um objeto.');
  }
  const label = labelFor(raw, index);

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Agendamento ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (typeof raw.cron !== 'string' || !raw.cron.trim()) {
    fail(`Agendamento "${label}": campo "cron" é obrigatório e deve ser um texto.`);
  }
  const cron = checkCron(raw.cron);
  if (!cron.valid) {
    fail(
      `Agendamento "${label}": expressão cron inválida "${raw.cron}"` +
        `${cron.reason ? ` — não é registrável: ${cron.reason}` : ''}.`
    );
  }
  if (typeof raw.messageId !== 'string' || !raw.messageId.trim()) {
    fail(`Agendamento "${label}": campo "messageId" é obrigatório.`);
  }
  if (messageIds && !messageIds.has(raw.messageId)) {
    fail(`Agendamento "${label}": a mensagem "${raw.messageId}" não existe.`);
  }
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) {
    fail(`Agendamento "${label}": campo "groups" deve ser uma lista de ids.`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    fail(`Agendamento "${label}": campo "enabled" deve ser true ou false.`);
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
    fail(`Agendamento "${label}": campo "id" deve ser um texto.`);
  }

  const groups = normalizeGroups(raw.groups?.length ? raw.groups : defaultGroups);
  if (groups.length === 0) {
    fail(`Agendamento "${label}": nenhum grupo de destino (defina "groups" ou "defaultGroups").`);
  }

  return {
    id: raw.id?.trim() || newId('sch'),
    name: raw.name.trim(),
    cron: raw.cron.trim(),
    messageId: raw.messageId,
    groups,
    enabled: raw.enabled ?? true,
  };
}

/**
 * Normaliza o conteúdo do arquivo para o formato v2, aceitando também o v1
 * (mensagem como texto dentro do agendamento).
 * @param {Record<string, unknown>} parsed Objeto já lido do JSON.
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 */
export function normalizeStore(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('Formato inválido: esperava um objeto com "schedules".');
  }
  if (parsed.defaultGroups !== undefined && !Array.isArray(parsed.defaultGroups)) {
    fail('Formato inválido: "defaultGroups" deve ser uma lista de ids.');
  }
  if (parsed.messages !== undefined && !Array.isArray(parsed.messages)) {
    fail('Formato inválido: "messages" deve ser uma lista.');
  }
  if (parsed.schedules !== undefined && !Array.isArray(parsed.schedules)) {
    fail('Formato inválido: "schedules" deve ser uma lista.');
  }

  const defaultGroups = normalizeGroups(parsed.defaultGroups ?? []);
  const messages = (parsed.messages ?? []).map(validateMessage);

  // v1: agendamento com "message" textual e sem "messageId" vira mensagem sintética.
  // Os campos são validados aqui como campos de AGENDAMENTO (não de mensagem: o
  // usuário v1 escreveu "message", não "text"), para que o erro fale do que o
  // usuário de fato escreveu no arquivo. O id de ambos (agendamento e mensagem
  // sintética) é derivado de forma determinística do nome do agendamento — que
  // já é único por validação — em vez de aleatório, para que duas leituras do
  // mesmo arquivo v1 produzam sempre os mesmos ids.
  const rawSchedules = (parsed.schedules ?? []).map((raw, index) => {
    if (raw && typeof raw === 'object' && !raw.messageId && typeof raw.message === 'string') {
      const label = labelFor(raw, index);
      if (typeof raw.name !== 'string' || !raw.name.trim()) {
        fail(`Agendamento ${label}: campo "name" é obrigatório e deve ser um texto.`);
      }
      if (!raw.message.trim()) {
        fail(`Agendamento "${label}": campo "message" é obrigatório e deve ser um texto.`);
      }

      const name = raw.name.trim();
      const created = validateMessage({ id: stableId('msg', name), name, text: raw.message });
      messages.push(created);
      const { message, ...rest } = raw;
      return { ...rest, id: rest.id ?? stableId('sch', name), messageId: created.id };
    }
    return raw;
  });

  const messageIds = new Set(messages.map((m) => m.id));
  const schedules = rawSchedules.map((raw, index) =>
    validateSchedule(raw, { defaultGroups, messageIds }, index)
  );

  const names = new Set();
  for (const schedule of schedules) {
    if (names.has(schedule.name)) {
      fail(`Agendamento "${schedule.name}": nome duplicado.`);
    }
    names.add(schedule.name);
  }

  const seenMessageIds = new Set();
  for (const msg of messages) {
    if (seenMessageIds.has(msg.id)) {
      fail(`Mensagem "${msg.id}": id duplicado.`);
    }
    seenMessageIds.add(msg.id);
  }

  return { version: 2, defaultGroups, messages, schedules };
}

/**
 * Lê e valida o arquivo de agendamentos, resolvendo o texto de cada mensagem.
 * @param {string} [path] Caminho do arquivo (default: config.schedulesPath).
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 *   Cada agendamento traz também "message" com o texto já resolvido.
 */
export function loadSchedules(path = config.schedulesPath) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler o arquivo de agendamentos ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON inválido em ${path}: ${err.message}`);
  }

  let store;
  try {
    store = normalizeStore(parsed);
  } catch (err) {
    throw new Error(`${err.message} (em ${path})`);
  }

  const textById = new Map(store.messages.map((m) => [m.id, m.text]));
  return {
    ...store,
    schedules: store.schedules.map((s) => ({ ...s, message: textById.get(s.messageId) })),
  };
}
