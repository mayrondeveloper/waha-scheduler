// Janela de silêncio: um intervalo de horas de parede no fuso do agendador,
// que pode virar a meia-noite (22:00 a 08:00). Funções puras.

import { instantToWall, wallToInstant } from './dates.js';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const nextDay = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * Diz se o instante cai dentro da janela de silêncio.
 * @param {number} nowMs Instante.
 * @param {{start: string, end: string}|null} quiet Janela em HH:MM, ou nulo (sem janela).
 * @param {string} timeZone Fuso IANA.
 * @returns {boolean}
 */
export function inQuietHours(nowMs, quiet, timeZone) {
  if (!quiet) return false;
  const now = toMinutes(instantToWall(nowMs, timeZone).slice(11));
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * O próximo fim da janela a partir do instante: hoje, se ainda não passou,
 * senão amanhã.
 * @param {number} nowMs Instante.
 * @param {{start: string, end: string}} quiet Janela em HH:MM.
 * @param {string} timeZone Fuso IANA.
 * @returns {number} Instante do fim da janela, em ms.
 */
export function quietEnd(nowMs, quiet, timeZone) {
  const today = instantToWall(nowMs, timeZone).slice(0, 10);
  const candidate = wallToInstant(`${today}T${quiet.end}`, timeZone);
  if (candidate > nowMs) return candidate;
  return wallToInstant(`${nextDay(today)}T${quiet.end}`, timeZone);
}
