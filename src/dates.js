// Hora de parede ("2026-09-13T10:00") num fuso IANA, sem dependência. É o
// formato do campo "at" dos envios únicos: relativo a TIMEZONE, como o cron.

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Deslocamento do fuso (ms) no instante dado: hora de parede menos UTC.
function offsetAt(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

function parseWall(wall) {
  const m = typeof wall === 'string' ? wall.match(WALL) : null;
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(guess);
  const real = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    && hour <= 23 && minute <= 59;
  return real ? guess : null;
}

/**
 * Diz se o valor é uma hora de parede válida no formato AAAA-MM-DDTHH:MM.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWall(value) {
  return parseWall(value) !== null;
}

/**
 * Converte uma hora de parede no fuso dado para o instante (ms desde a época).
 * @param {string} wall Ex.: "2026-09-13T10:00".
 * @param {string} timeZone Fuso IANA, ex.: "America/Sao_Paulo".
 * @returns {number}
 */
export function wallToInstant(wall, timeZone) {
  const guess = parseWall(wall);
  if (guess === null) {
    throw new Error(`Data/hora inválida: "${wall}". Use o formato AAAA-MM-DDTHH:MM.`);
  }
  // Primeira passada usa o deslocamento do instante "ingênuo"; a segunda,
  // o do instante corrigido, o que acerta os dias de virada de horário de
  // verão.
  let instant = guess - offsetAt(guess, timeZone);
  instant = guess - offsetAt(instant, timeZone);
  return instant;
}

/**
 * Hora de parede (no fuso dado) de um instante, no mesmo formato de "at".
 * @param {number|string|Date} when Instante.
 * @param {string} timeZone Fuso IANA.
 * @returns {string} Ex.: "2026-09-13T10:00".
 */
export function instantToWall(when, timeZone) {
  const ms = new Date(when).getTime();
  const local = new Date(ms + offsetAt(ms, timeZone));
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}
