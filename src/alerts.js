// Alertas ao dono: WhatsApp (para o número da própria sessão) e URL de push
// (ntfy.sh ou similar). Disparar e esquecer: nunca lançam, nunca atrasam um
// envio; o erro fica no log do agendador.

import { error as logError } from './logger.js';

const PUSH_TIMEOUT_MS = 5000;

/**
 * Manda um alerta pelos canais pedidos que estiverem configurados.
 * @param {{title: string, text: string, channels: Array<'whatsapp'|'push'>}} alert
 * @param {{settings: object, cfg: object, client: {sendText: Function}, me: {id: string}|null,
 *          fetchImpl?: typeof fetch}} deps
 *   settings: os ajustes (alerts.whatsapp, alerts.pushUrl); me: a identidade
 *   da sessão (destino do WhatsApp); fetchImpl: injetável nos testes.
 * @returns {Promise<Array<'whatsapp'|'push'>>} Canais em que o envio deu certo.
 */
export async function sendAlert({ title, text, channels }, { settings, cfg, client, me, fetchImpl = fetch }) {
  const sent = [];
  const alerts = settings?.alerts ?? {};

  if (channels.includes('whatsapp') && alerts.whatsapp && me?.id) {
    try {
      await client.sendText(me.id, `*${title}*\n${text}`, cfg);
      sent.push('whatsapp');
    } catch (err) {
      logError(`Alerta "${title}" não foi para o WhatsApp: ${err.message}`);
    }
  }

  if (channels.includes('push') && alerts.pushUrl) {
    try {
      const res = await fetchImpl(alerts.pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: title },
        body: text,
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Erro ${res.status} ao chamar ${alerts.pushUrl}`);
      sent.push('push');
    } catch (err) {
      logError(`Alerta "${title}" não foi para a URL de push: ${err.message}`);
    }
  }

  return sent;
}
