// Datas por extenso no fuso do agendador (TIMEZONE), não no do navegador.

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

// Partes da data no fuso pedido. hourCycle h23 evita o "24:00" que alguns
// motores devolvem para meia-noite.
function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: Number(get('year')),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday: WEEKDAY_EN.indexOf(get('weekday')),
  };
}

// Dia do calendário como número, para comparar "hoje", "amanhã" e "ontem"
// no fuso pedido.
function dayNumber(p) {
  return Math.floor(Date.UTC(p.year, Number(p.month) - 1, Number(p.day)) / DAY_MS);
}

/**
 * Data e hora por extenso: "hoje, 18:00", "amanhã, 09:00", "ontem, 23:39",
 * "sex 18/09, 18:00" ou, em outro ano, "18/09/2025, 18:00".
 * @param {string|number|Date} when Instante a descrever.
 * @param {{timeZone?: string, now?: number}} [options] Fuso de referência
 *   (default: o do navegador) e "agora" em ms (default: Date.now()).
 * @returns {string}
 */
export function formatWhen(when, { timeZone, now = Date.now() } = {}) {
  const p = partsIn(new Date(when), timeZone);
  const today = partsIn(new Date(now), timeZone);
  const time = `${p.hour}:${p.minute}`;
  const diff = dayNumber(p) - dayNumber(today);
  if (diff === 0) return `hoje, ${time}`;
  if (diff === 1) return `amanhã, ${time}`;
  if (diff === -1) return `ontem, ${time}`;
  if (p.year !== today.year) return `${p.day}/${p.month}/${p.year}, ${time}`;
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day}/${p.month}, ${time}`;
}

/**
 * Uma hora de parede do agendador ("2026-09-13T10:00", já no fuso dele) por
 * extenso: "sáb 13/09, 10:00", ou com o ano quando não é o ano corrente.
 * Não converte fuso: a parede é o que o usuário escolheu.
 * @param {string} wall
 * @param {{timeZone?: string, now?: number}} [options] Só para saber o ano corrente.
 * @returns {string} '' quando o valor não é uma parede completa.
 */
export function describeAt(wall, { timeZone, now = Date.now() } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall ?? '');
  if (!m) return '';
  const [year, month, day, hour, minute] = m.slice(1);
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  const time = `${hour}:${minute}`;
  if (Number(year) !== partsIn(new Date(now), timeZone).year) return `${day}/${month}/${year}, ${time}`;
  return `${WEEKDAY_SHORT[weekday]} ${day}/${month}, ${time}`;
}

/**
 * Só o horário, "HH:MM" ou "HH:MM:SS", no fuso pedido.
 * @param {string|number|Date} when
 * @param {{timeZone?: string, seconds?: boolean}} [options]
 * @returns {string}
 */
export function formatTime(when, { timeZone, seconds = false } = {}) {
  const p = partsIn(new Date(when), timeZone);
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}
