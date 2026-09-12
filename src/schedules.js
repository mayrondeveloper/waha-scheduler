// Leitura e validação do arquivo de agendamentos (schedules.json).

import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { schedule as scheduleCron, validate as isValidCron } from 'node-cron';
import { assertTimezone, config } from './config.js';
import { normalizeGroups } from './broadcast.js';
import { MEDIA_KINDS } from './media.js';
import { isWall } from './dates.js';

function fail(message) {
  throw new Error(message);
}

/**
 * Id aleatório curto com prefixo: "sch-1a2b3c4d".
 * @param {string} prefix
 * @returns {string}
 */
export function newId(prefix) {
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

  // Um fuso inválido não é defeito da expressão. Sem esta checagem, o erro do
  // node-cron ("Invalid time zone specified") era capturado abaixo e devolvido
  // como motivo de "cron inválido", mandando o usuário procurar o problema no
  // schedules.json em vez de no .env.
  assertTimezone(timezone);

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

// Metadados do anexo, como ficam no arquivo. O conteúdo em si está em
// data/media; aqui só se confere que a referência é utilizável.
function validateMedia(raw, label) {
  const bad = (why) => fail(`Mensagem "${label}": campo "media" ${why}.`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('deve ser um objeto');
  if (typeof raw.id !== 'string' || !/^[\w-]+$/.test(raw.id)) bad('precisa de um "id" válido');
  if (typeof raw.filename !== 'string' || !raw.filename.trim()) bad('precisa de "filename"');
  if (typeof raw.mimetype !== 'string' || !raw.mimetype.trim()) bad('precisa de "mimetype"');
  if (!Number.isInteger(raw.size) || raw.size < 0) bad('precisa de "size" inteiro');
  if (!MEDIA_KINDS.includes(raw.kind)) bad(`tem "kind" inválido "${raw.kind}" (use ${MEDIA_KINDS.join(', ')})`);
  return { id: raw.id, filename: raw.filename.trim(), mimetype: raw.mimetype.trim(), size: raw.size, kind: raw.kind };
}

/**
 * Valida e normaliza uma mensagem da biblioteca.
 * @param {Record<string, unknown>} raw Mensagem crua.
 * @param {number} [index] Posição no array "messages" (rotula erros sem nome como #1, #2, ...).
 * @returns {{id: string, name: string, text: string, media?: object}}
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
  // Sem anexo, o campo nem existe: o arquivo de quem não usa anexo não muda.
  const media = raw.media == null ? null : validateMedia(raw.media, label);

  return {
    id: raw.id?.trim() || newId('msg'),
    name: raw.name.trim(),
    text: raw.text,
    ...(media && { media }),
  };
}

/**
 * Valida e normaliza uma lista de grupos do cadastro "groupLists".
 * @param {Record<string, unknown>} raw Lista crua.
 * @param {number} [index] Posição no array (rotula erros sem nome como #1, #2, ...).
 * @returns {{id: string, name: string, groups: string[]}}
 */
export function validateGroupList(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Lista de grupos: cada item de "groupLists" deve ser um objeto.');
  }
  const label = labelFor(raw, index);
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Lista de grupos ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
    fail(`Lista de grupos "${label}": campo "id" deve ser um texto.`);
  }
  if (!Array.isArray(raw.groups)) {
    fail(`Lista de grupos "${label}": campo "groups" deve ser uma lista de ids.`);
  }
  const groups = normalizeGroups(raw.groups);
  if (groups.length === 0) {
    fail(`Lista de grupos "${label}": selecione ao menos um grupo.`);
  }
  return { id: raw.id?.trim() || newId('lst'), name: raw.name.trim(), groups };
}

/**
 * Destinos de um agendamento: os grupos avulsos e, depois, os das listas
 * que ele referencia, na ordem escolhida e sem repetição. Lista que não
 * existe mais contribui com nada (a validação do arquivo já a recusa).
 * @param {{groups?: string[], groupLists?: string[]}} schedule
 * @param {Array<{id: string, groups: string[]}>} groupLists Cadastro de listas.
 * @returns {string[]}
 */
export function resolveTargets(schedule, groupLists = []) {
  const byId = new Map(groupLists.map((l) => [l.id, l]));
  const fromLists = (schedule.groupLists ?? []).flatMap((id) => byId.get(id)?.groups ?? []);
  return normalizeGroups([...(schedule.groups ?? []), ...fromLists]);
}

function isIsoOrNull(value) {
  return value == null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

/**
 * Valida e normaliza um agendamento.
 * Campos opcionais (at, groupLists, firedAt, missedAt) só aparecem no
 * retorno quando presentes: o arquivo de quem não os usa não muda.
 * @param {Record<string, unknown>} raw Agendamento cru.
 * @param {{defaultGroups?: string[], messageIds?: Set<string>, listIds?: Set<string>}} [context]
 *   messageIds: ids válidos da biblioteca; listIds: ids válidos de "groupLists".
 *   Quando informados, "messageId" e "groupLists" são conferidos.
 * @param {number} [index] Posição no array "schedules" (rotula erros sem nome como #1, #2, ...).
 * @returns {{id: string, name: string, cron?: string, at?: string, messageId: string, groups: string[],
 *            groupLists?: string[], enabled: boolean, firedAt?: string, missedAt?: string}}
 */
export function validateSchedule(raw, context = {}, index) {
  const { defaultGroups = [], messageIds = null, listIds = null } = context;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('Agendamento: cada item de "schedules" deve ser um objeto.');
  }
  const label = labelFor(raw, index);

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Agendamento ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }

  // Repetição (cron) ou envio único (at): exatamente um dos dois.
  const hasCron = raw.cron != null && raw.cron !== '';
  const hasAt = raw.at != null && raw.at !== '';
  if (hasCron === hasAt) {
    fail(`Agendamento "${label}": informe "cron" (repetição) ou "at" (envio único), um dos dois.`);
  }
  if (hasCron) {
    if (typeof raw.cron !== 'string' || !raw.cron.trim()) {
      fail(`Agendamento "${label}": campo "cron" deve ser um texto.`);
    }
    const cron = checkCron(raw.cron);
    if (!cron.valid) {
      fail(
        `Agendamento "${label}": expressão cron inválida "${raw.cron}"` +
          `${cron.reason ? ` — não é registrável: ${cron.reason}` : ''}.`
      );
    }
  } else if (!isWall(raw.at)) {
    fail(`Agendamento "${label}": campo "at" deve ser uma data e hora no formato AAAA-MM-DDTHH:MM.`);
  }
  if (!isIsoOrNull(raw.firedAt)) fail(`Agendamento "${label}": campo "firedAt" deve ser uma data ISO.`);
  if (!isIsoOrNull(raw.missedAt)) fail(`Agendamento "${label}": campo "missedAt" deve ser uma data ISO.`);

  if (raw.groupLists !== undefined && raw.groupLists !== null) {
    if (!Array.isArray(raw.groupLists) || raw.groupLists.some((id) => typeof id !== 'string' || !id.trim())) {
      fail(`Agendamento "${label}": campo "groupLists" deve ser uma lista de ids de listas.`);
    }
    for (const id of raw.groupLists) {
      if (listIds && !listIds.has(id)) fail(`Agendamento "${label}": a lista "${id}" não existe.`);
    }
  }
  const groupLists = [...new Set((raw.groupLists ?? []).map((id) => id.trim()))];

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

  // "groups" ausente (e sem listas) herda defaultGroups; "groups" informado
  // como lista vazia sem nenhuma lista é erro, não herança. Com um seletor
  // de grupos na tela, a lista vazia é uma escolha do usuário, e herdar os
  // defaults nesse caso trocaria os destinatários em silêncio. Com uma
  // lista marcada, "groups: []" é só "nenhum grupo avulso".
  if (raw.groups !== undefined && raw.groups.length === 0 && groupLists.length === 0) {
    fail(`Agendamento "${label}": lista de grupos vazia — selecione ao menos um grupo de destino.`);
  }

  const groups = normalizeGroups(raw.groups ?? (groupLists.length === 0 ? defaultGroups : []));
  if (groups.length === 0 && groupLists.length === 0) {
    fail(`Agendamento "${label}": nenhum grupo de destino (defina "groups" ou "defaultGroups").`);
  }

  return {
    id: raw.id?.trim() || newId('sch'),
    name: raw.name.trim(),
    ...(hasCron ? { cron: raw.cron.trim() } : { at: raw.at }),
    messageId: raw.messageId,
    groups,
    ...(groupLists.length > 0 && { groupLists }),
    enabled: raw.enabled ?? true,
    ...(raw.firedAt != null && { firedAt: raw.firedAt }),
    ...(raw.missedAt != null && { missedAt: raw.missedAt }),
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
  if (parsed.groupLists !== undefined && !Array.isArray(parsed.groupLists)) {
    fail('Formato inválido: "groupLists" deve ser uma lista.');
  }

  const defaultGroups = normalizeGroups(parsed.defaultGroups ?? []);
  const messages = (parsed.messages ?? []).map(validateMessage);

  const groupLists = (parsed.groupLists ?? []).map(validateGroupList);
  const listNames = new Set();
  const listIds = new Set();
  for (const list of groupLists) {
    if (listIds.has(list.id)) fail(`Lista de grupos "${list.id}": id duplicado.`);
    if (listNames.has(list.name)) fail(`Lista de grupos "${list.name}": nome duplicado.`);
    listIds.add(list.id);
    listNames.add(list.name);
  }

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
    validateSchedule(raw, { defaultGroups, messageIds, listIds }, index)
  );

  const names = new Set();
  for (const schedule of schedules) {
    if (names.has(schedule.name)) {
      fail(`Agendamento "${schedule.name}": nome duplicado.`);
    }
    names.add(schedule.name);
    // Uma lista pode existir e estar vazia de grupos válidos só em teoria
    // (validateGroupList exige ao menos um); a checagem cobre o caso de
    // "groups: []" com listas que, somadas, não trazem ninguém.
    if (resolveTargets(schedule, groupLists).length === 0) {
      fail(`Agendamento "${schedule.name}": nenhum grupo de destino nas listas escolhidas.`);
    }
  }

  const seenMessageIds = new Set();
  const seenMessageNames = new Set();
  for (const msg of messages) {
    if (seenMessageIds.has(msg.id)) {
      fail(`Mensagem "${msg.id}": id duplicado.`);
    }
    // Nome duplicado vira duas opções idênticas no seletor da tela, sem o
    // usuário ter como distinguir qual texto vai ser enviado. A API já recusa
    // isso; a leitura precisa recusar também, senão um arquivo editado à mão
    // contorna a garantia.
    if (seenMessageNames.has(msg.name)) {
      fail(`Mensagem "${msg.name}": nome duplicado.`);
    }
    seenMessageIds.add(msg.id);
    seenMessageNames.add(msg.name);
  }

  return { version: 2, defaultGroups, groupLists, messages, schedules };
}

/**
 * Lê e valida o arquivo de agendamentos, resolvendo o texto de cada mensagem.
 * @param {string} [path] Caminho do arquivo (default: config.schedulesPath).
 * @returns {{version: 2, defaultGroups: string[], groupLists: object[], messages: object[], schedules: object[]}}
 *   Cada agendamento traz também "message" (texto resolvido), "media" e
 *   "targets" (grupos avulsos mais os das listas, sem repetição).
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

  const byId = new Map(store.messages.map((m) => [m.id, m]));
  return {
    ...store,
    schedules: store.schedules.map((s) => ({
      ...s,
      message: byId.get(s.messageId)?.text,
      media: byId.get(s.messageId)?.media ?? null,
      targets: resolveTargets(s, store.groupLists),
    })),
  };
}
