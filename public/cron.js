// Dias da semana e horário <-> expressão cron. A tela pede dias e horário; o
// arquivo continua guardando um cron, que é o que o agendador registra.

/**
 * Dias na ordem da tela: a semana começa na segunda, como no calendário
 * brasileiro, mas o número é o do cron (0 = domingo).
 */
export const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Monta o cron "minuto hora * * dias"; todos os dias viram "*".
 * @param {number[]} days Dias no número do cron (0 = domingo).
 * @param {string} time Horário "HH:MM".
 * @returns {string}
 */
export function buildCron(days, time) {
  const [hour, minute] = time.split(':').map(Number);
  const weekdays = days.length === WEEKDAYS.length ? '*' : [...days].sort((a, b) => a - b).join(',');
  return `${minute} ${hour} * * ${weekdays}`;
}

/**
 * Converte o cron de volta em dias e horário. Só o formato exato
 * "minuto hora * * dias" cabe; qualquer outra forma (passo, dia do mês, mês,
 * segundos, nome de dia) devolve null e fica como cron personalizado.
 * @param {string} expr
 * @returns {{days: number[], time: string} | null}
 */
export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, weekdays] = fields;
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return null;
  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) return null;
  if (dayOfMonth !== '*' || month !== '*') return null;

  const days = [];
  if (weekdays === '*') {
    days.push(...WEEKDAYS.map((d) => d.value));
  } else {
    for (const part of weekdays.split(',')) {
      const range = /^([0-7])(?:-([0-7]))?$/.exec(part);
      if (!range) return null;
      const start = Number(range[1]);
      const end = range[2] === undefined ? start : Number(range[2]);
      if (end < start) return null;
      // 7 também é domingo no cron.
      for (let day = start; day <= end; day++) days.push(day % 7);
    }
  }

  return {
    days: [...new Set(days)].sort((a, b) => a - b),
    time: `${pad(Number(hour))}:${pad(Number(minute))}`,
  };
}

/**
 * Descreve quando o agendamento dispara ("Seg, Qua e Sex às 09:00").
 * @param {string} expr
 * @returns {string|null} null para cron personalizado.
 */
export function describeCron(expr) {
  const parsed = parseCron(expr);
  if (!parsed) return null;

  const labels = WEEKDAYS.filter((d) => parsed.days.includes(d.value)).map((d) => d.label);
  const when = labels.length === WEEKDAYS.length ? 'Todo dia'
    : labels.length === 1 ? labels[0]
    : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
  return `${when} às ${parsed.time}`;
}
