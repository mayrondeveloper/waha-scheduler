// Leitura e validação do arquivo de agendamentos (schedules.json).

import { readFileSync } from 'node:fs';
import { validate as isValidCron } from 'node-cron';
import { config } from './config.js';
import { normalizeGroups } from './broadcast.js';

function fail(message) {
  throw new Error(message);
}

function validateSchedule(raw, index, defaultGroups) {
  const label = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `#${index + 1}`;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`Agendamento ${label}: cada item de "schedules" deve ser um objeto.`);
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    fail(`Agendamento ${label}: campo "name" é obrigatório e deve ser um texto.`);
  }
  if (typeof raw.cron !== 'string' || !raw.cron.trim()) {
    fail(`Agendamento "${label}": campo "cron" é obrigatório e deve ser um texto.`);
  }
  if (!isValidCron(raw.cron)) {
    fail(`Agendamento "${label}": expressão cron inválida "${raw.cron}".`);
  }
  if (typeof raw.message !== 'string' || !raw.message.trim()) {
    fail(`Agendamento "${label}": campo "message" é obrigatório e deve ser um texto.`);
  }
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) {
    fail(`Agendamento "${label}": campo "groups" deve ser uma lista de ids.`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    fail(`Agendamento "${label}": campo "enabled" deve ser true ou false.`);
  }

  const groups = normalizeGroups(raw.groups ?? defaultGroups);
  if (groups.length === 0) {
    fail(`Agendamento "${label}": nenhum grupo de destino (defina "groups" ou "defaultGroups").`);
  }

  return {
    name: raw.name.trim(),
    cron: raw.cron.trim(),
    message: raw.message,
    groups,
    enabled: raw.enabled ?? true,
  };
}

/**
 * Lê e valida o arquivo de agendamentos, resolvendo grupos default por agendamento.
 * @param {string} [path] Caminho do arquivo (default: config.schedulesPath).
 * @returns {{defaultGroups: string[], schedules: Array<{name: string, cron: string, message: string, groups: string[], enabled: boolean}>}}
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

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Formato inválido em ${path}: esperava um objeto com "schedules".`);
  }
  if (parsed.defaultGroups !== undefined && !Array.isArray(parsed.defaultGroups)) {
    throw new Error(`Formato inválido em ${path}: "defaultGroups" deve ser uma lista de ids.`);
  }
  if (parsed.schedules !== undefined && !Array.isArray(parsed.schedules)) {
    throw new Error(`Formato inválido em ${path}: "schedules" deve ser uma lista.`);
  }

  const defaultGroups = normalizeGroups(parsed.defaultGroups ?? []);
  const schedules = (parsed.schedules ?? []).map((item, i) =>
    validateSchedule(item, i, defaultGroups)
  );

  const names = new Set();
  for (const schedule of schedules) {
    if (names.has(schedule.name)) {
      throw new Error(`Agendamento "${schedule.name}": nome duplicado em ${path}.`);
    }
    names.add(schedule.name);
  }

  return { defaultGroups, schedules };
}
