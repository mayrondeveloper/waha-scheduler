// Agrupa o log de envios (uma linha por grupo) em disparos, para o histórico.

const GAP_MS = 60_000;
const MANUAL_SUFFIX = ' (manual)';
const LABEL_NAMES = { 'send-now': 'Envio pelo terminal' };

/**
 * Agrupa as linhas do log por disparo. Linhas com `dispatchId` agrupam por
 * ele. Linhas antigas, sem o campo, seguem a regra aproximada: uma linha
 * começa um disparo novo quando o rótulo muda, quando passou mais de 60 s
 * da anterior ou quando o grupo já apareceu no disparo atual (um disparo
 * manda uma vez para cada grupo; isso separa disparos seguidos de um cron
 * que roda a cada minuto).
 * @param {Array<{ts: string, status: string, chatId: string, label?: string|null, error?: string,
 *          dispatchId?: string, tracking?: string, links?: number}>} logs
 *   Em qualquer ordem; a API devolve do mais recente para o mais antigo.
 * @returns {Array<{name: string, manual: boolean, startedAt: string, entries: object[], sent: number, failed: number,
 *            skipped: number, deferredFrom: string|null, dispatchId: string|null, tracking: string|null, links: number|null}>}
 *   Do disparo mais recente para o mais antigo; entries em ordem cronológica.
 */
export function groupDispatches(logs) {
  const ordered = [...logs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const dispatches = [];
  let current = null;

  for (const entry of ordered) {
    const label = entry.label ?? '';
    const previous = current?.entries.at(-1);
    const byId = Boolean(entry.dispatchId || current?.dispatchId);
    const startsNew = !current
      || (byId
        ? current.dispatchId !== (entry.dispatchId ?? null)
        : current.label !== label
          || Date.parse(entry.ts) - Date.parse(previous.ts) > GAP_MS
          || current.entries.some((e) => e.chatId === entry.chatId));
    if (startsNew) {
      current = { label, dispatchId: entry.dispatchId ?? null, entries: [] };
      dispatches.push(current);
    }
    current.entries.push(entry);
  }

  return dispatches.reverse().map(({ label, dispatchId, entries }) => {
    const manual = label.endsWith(MANUAL_SUFFIX);
    const base = manual ? label.slice(0, -MANUAL_SUFFIX.length) : label;
    const failed = entries.filter((e) => e.status === 'error').length;
    const skipped = entries.filter((e) => e.status === 'skipped').length;
    return {
      name: LABEL_NAMES[base] ?? (base || 'Envio sem rótulo'),
      manual,
      startedAt: entries[0].ts,
      entries,
      sent: entries.length - failed - skipped,
      failed,
      skipped,
      // Disparo adiado pela janela de silêncio: o horário original.
      deferredFrom: entries[0].deferredFrom ?? null,
      // Cliques: identidade do disparo e se foi medido.
      dispatchId,
      tracking: entries[0].tracking ?? null,
      links: entries[0].links ?? null,
    };
  });
}

/**
 * O último disparo de cada agendamento, pelo nome exibido (sem o sufixo
 * "(manual)"): é o que decide o badge "Falha no envio" do card.
 * @param {ReturnType<typeof groupDispatches>} dispatches Do mais recente para o mais antigo.
 * @returns {Record<string, object>}
 */
export function lastDispatchByName(dispatches) {
  const last = {};
  for (const d of dispatches) if (!Object.hasOwn(last, d.name)) last[d.name] = d;
  return last;
}
