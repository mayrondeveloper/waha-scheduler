// Agrupa o log de envios (uma linha por grupo) em disparos, para o histórico.

const GAP_MS = 60_000;
const MANUAL_SUFFIX = ' (manual)';
const LABEL_NAMES = { 'send-now': 'Envio pelo terminal' };

/**
 * Agrupa as linhas do log por disparo. Uma linha começa um disparo novo
 * quando o rótulo muda, quando passou mais de 60 s da anterior ou quando o
 * grupo já apareceu no disparo atual (um disparo manda uma vez para cada
 * grupo; isso separa disparos seguidos de um cron que roda a cada minuto).
 * @param {Array<{ts: string, status: 'sent'|'error', chatId: string, label?: string|null, error?: string}>} logs
 *   Em qualquer ordem; a API devolve do mais recente para o mais antigo.
 * @returns {Array<{name: string, manual: boolean, startedAt: string, entries: object[], sent: number, failed: number}>}
 *   Do disparo mais recente para o mais antigo; entries em ordem cronológica.
 */
export function groupDispatches(logs) {
  const ordered = [...logs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const dispatches = [];
  let current = null;

  for (const entry of ordered) {
    const label = entry.label ?? '';
    const previous = current?.entries.at(-1);
    const startsNew = !current
      || current.label !== label
      || Date.parse(entry.ts) - Date.parse(previous.ts) > GAP_MS
      || current.entries.some((e) => e.chatId === entry.chatId);
    if (startsNew) {
      current = { label, entries: [] };
      dispatches.push(current);
    }
    current.entries.push(entry);
  }

  return dispatches.reverse().map(({ label, entries }) => {
    const manual = label.endsWith(MANUAL_SUFFIX);
    const base = manual ? label.slice(0, -MANUAL_SUFFIX.length) : label;
    const failed = entries.filter((e) => e.status === 'error').length;
    return {
      name: LABEL_NAMES[base] ?? (base || 'Envio sem rótulo'),
      manual,
      startedAt: entries[0].ts,
      entries,
      sent: entries.length - failed,
      failed,
    };
  });
}
