// Aba "Ajustes": pausa geral, janela de silêncio, limite por hora e alertas.
// Só gera HTML e lê o formulário recebido.

import { escape, icon } from './html.js';

/**
 * Subtítulo do cabeçalho da aba.
 * @returns {string}
 */
export function settingsSubtitle() {
  return 'Pausa geral, janela de silêncio, limite por hora e alertas';
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Diz se um horário de parede (HH:MM) cai dentro da janela de silêncio. É a
 * mesma regra do agendador, sobre a hora que o usuário escolheu no formulário.
 * @param {string} hhmm
 * @param {{start: string, end: string}|null|undefined} quiet
 * @returns {boolean}
 */
export function timeInQuiet(hhmm, quiet) {
  if (!quiet || !/^\d{2}:\d{2}$/.test(hhmm ?? '')) return false;
  const t = toMinutes(hhmm);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/**
 * Texto do aviso no formulário de agendamento quando o horário cai na
 * janela, ou '' fora dela.
 * @param {string} hhmm
 * @param {{start: string, end: string}|null|undefined} quiet
 * @returns {string}
 */
export function quietHint(hhmm, quiet) {
  return timeInQuiet(hhmm, quiet)
    ? `Dentro da janela de silêncio (${quiet.start} a ${quiet.end}): o envio sai às ${quiet.end}.`
    : '';
}

function sessionLine(session) {
  if (!session) return 'consultando a sessão do WAHA…';
  if (session.error) return `sessão do WAHA indisponível (${session.error})`;
  if (!session.me) return `sessão "${session.status}", sem número conectado`;
  const number = session.me.id.replace(/@.*$/, '');
  return `para ${session.me.pushName || 'o número da sessão'} · +${number}`;
}

/**
 * HTML do formulário de ajustes.
 * @param {{settings: object, session: {status: string, me: object|null, error?: string}|null}} input
 *   session: resultado de GET /api/session (nulo enquanto carrega).
 * @returns {string}
 */
export function settingsForm({ settings, session = null }) {
  const quiet = settings.quietHours;
  return `
    <form id="form-settings" class="settings-form" novalidate>
      <section class="settings-section">
        <h3 class="settings-title">Pausa geral</h3>
        <label class="check">
          <input type="checkbox" name="paused" ${settings.paused ? 'checked' : ''} />
          <span>Pausar todos os envios</span>
        </label>
        <p class="note">Pausado, nenhum agendamento dispara e o histórico registra cada disparo pulado. Envios únicos ficam esperando a retomada. O "Enviar agora" continua funcionando, com aviso.</p>
      </section>

      <section class="settings-section">
        <h3 class="settings-title">Janela de silêncio</h3>
        <label class="check">
          <input type="checkbox" name="quietEnabled" ${quiet ? 'checked' : ''} />
          <span>Não enviar entre</span>
        </label>
        <div class="when-row quiet-row">
          <label class="time"><span class="visually-hidden">Início</span><input type="time" name="quietStart" value="${escape(quiet?.start ?? '22:00')}" /></label>
          <span class="muted">e</span>
          <label class="time"><span class="visually-hidden">Fim</span><input type="time" name="quietEnd" value="${escape(quiet?.end ?? '08:00')}" /></label>
        </div>
        <p class="note">Um disparo que cair na janela é adiado para o fim dela, e o histórico diz que foi adiado. A janela pode virar a meia-noite.</p>
      </section>

      <section class="settings-section">
        <h3 class="settings-title">Limite por hora</h3>
        <label class="field">
          <span class="field-label">Envios por hora, no máximo</span>
          <input type="number" name="hourlyLimit" min="0" max="1000" step="1" value="${escape(settings.hourlyLimit)}" />
        </label>
        <p class="note">Conta o que saiu na última hora, pelo agendador e pela tela. No limite, o disparo espera a vez em vez de perder o envio. 0 desliga.</p>
      </section>

      <section class="settings-section">
        <h3 class="settings-title">Alertas</h3>
        <label class="check">
          <input type="checkbox" name="alertWhatsapp" ${settings.alerts.whatsapp ? 'checked' : ''} />
          <span>Avisar no WhatsApp <small class="muted" data-role="session-line">${escape(sessionLine(session))}</small></span>
        </label>
        <p class="note">Falhas num disparo, envio único perdido e a volta do número vão para o próprio número da sessão.</p>
        <label class="field">
          <span class="field-label">URL de push (ntfy.sh ou similar)</span>
          <input type="url" name="pushUrl" value="${escape(settings.alerts.pushUrl)}" placeholder="https://ntfy.sh/seu-topico" autocomplete="off" />
        </label>
        <p class="note">Recebe um POST em texto com o cabeçalho Title. É o único canal que consegue avisar quando o número cai, porque o WhatsApp não avisa de si mesmo.</p>
        <button type="button" class="btn btn-sm" data-action="alert-test">${icon('send')} Enviar teste</button>
      </section>

      <footer class="settings-footer">
        <p class="form-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary">Salvar ajustes</button>
      </footer>
    </form>`;
}

/**
 * Os ajustes que o formulário representa, no formato de PUT /api/settings.
 * @param {{querySelector: Function}} form
 * @returns {object}
 */
export function formSettings(form) {
  const checked = (name) => Boolean(form.querySelector(`[name="${name}"]`)?.checked);
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? '';
  const quietEnabled = checked('quietEnabled');
  const start = value('quietStart');
  const end = value('quietEnd');
  return {
    paused: checked('paused'),
    quietHours: quietEnabled && start && end ? { start, end } : null,
    hourlyLimit: Number(value('hourlyLimit')),
    alerts: { whatsapp: checked('alertWhatsapp'), pushUrl: value('pushUrl').trim() },
  };
}
