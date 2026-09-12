// Aba Ajustes, faixa de status com pausa e janela, avisos do envio manual,
// aviso da janela no formulário e o histórico com pulado, adiado e freio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeForm } from './fake-dom.js';
import * as app from '../public/app.js';
import { settingsForm, formSettings, timeInQuiet, quietHint } from '../public/settings-view.js';
import { statusBar } from '../public/status-view.js';
import { sendConfirm, scheduleForm } from '../public/schedules-view.js';
import { groupDispatches } from '../public/history.js';
import { historyView } from '../public/history-view.js';

const SP = 'America/Sao_Paulo';
const NOW = Date.parse('2026-09-12T02:30:00Z'); // 23:30 em SP
const DEFAULTS = { paused: false, quietHours: null, hourlyLimit: 50, alerts: { whatsapp: true, pushUrl: '' } };
const SESSION = { status: 'WORKING', me: { id: '5511999999999@c.us', pushName: 'Dono' } };

test('timeInQuiet e quietHint seguem a mesma regra do agendador, sobre a hora de parede', () => {
  const night = { start: '22:00', end: '08:00' };
  assert.equal(timeInQuiet('23:00', night), true);
  assert.equal(timeInQuiet('06:00', night), true);
  assert.equal(timeInQuiet('08:00', night), false);
  assert.equal(timeInQuiet('12:00', night), false);
  assert.equal(timeInQuiet('12:00', null), false);
  assert.equal(timeInQuiet('', night), false);
  assert.equal(quietHint('23:00', night), 'Dentro da janela de silêncio (22:00 a 08:00): o envio sai às 08:00.');
  assert.equal(quietHint('12:00', night), '');
});

test('formulário de ajustes desenha os valores e formSettings devolve o objeto do PUT', () => {
  const settings = { paused: true, quietHours: { start: '22:00', end: '08:00' }, hourlyLimit: 20, alerts: { whatsapp: false, pushUrl: 'https://ntfy.sh/x' } };
  const html = settingsForm({ settings, session: SESSION });
  assert.match(html, /id="form-settings"/);
  assert.match(html, /name="paused" checked/);
  assert.match(html, /name="quietEnabled" checked/);
  assert.match(html, /name="hourlyLimit" min="0" max="1000" step="1" value="20"/);
  assert.match(html, /para Dono · \+5511999999999/);
  assert.match(html, /data-action="alert-test"/);
  assert.deepEqual(formSettings(fakeForm(html)), settings);

  const plain = settingsForm({ settings: DEFAULTS, session: null });
  assert.match(plain, /consultando a sessão/);
  assert.deepEqual(formSettings(fakeForm(plain)), DEFAULTS, 'janela desligada vira nulo mesmo com horários preenchidos');
  assert.match(settingsForm({ settings: DEFAULTS, session: { status: 'SCAN_QR_CODE', me: null } }), /sem número conectado/);
});

test('faixa de status: pausado em vermelho com Retomar e sem próximo envio; janela de silêncio com o fim', () => {
  const base = {
    statusError: null, groupsError: null, groupsLoaded: true, now: NOW,
    schedules: [{ id: 'a', name: 'x', enabled: true }],
  };
  const status = (extra) => ({
    now: new Date(NOW).toISOString(), timezone: SP, timezoneLabel: 'Brasília',
    scheduler: { state: 'running', startedAt: null, beatAt: new Date(NOW).toISOString(), reloadError: null },
    nextRuns: { a: '2026-09-12T12:00:00Z' }, paused: false, quietUntil: null, ...extra,
  });
  const paused = statusBar({ ...base, status: status({ paused: true }) });
  assert.match(paused, /tone-danger"><span class="dot" aria-hidden="true"><\/span><span>Envios pausados<\/span><button type="button" class="link" data-action="resume-all">Retomar<\/button>/);
  assert.doesNotMatch(paused, /Próximo envio/);

  const quiet = statusBar({ ...base, status: status({ quietUntil: '2026-09-12T11:00:00Z' }) });
  assert.match(quiet, /Janela de silêncio até 08:00/);
  assert.match(quiet, /Próximo envio/);

  const normal = statusBar({ ...base, status: status({}) });
  assert.doesNotMatch(normal, /pausados|silêncio/);
});

test('modal de envio mostra os avisos; formulário de agendamento tem o lugar do aviso da janela', () => {
  const schedule = { id: 'a', name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'] };
  const html = sendConfirm({ schedule, message: { text: 'oi' }, groupName: (id) => id, warnings: ['Envios pausados: sai mesmo assim.'] });
  assert.match(html, /<ul class="warnings"><li>.*Envios pausados: sai mesmo assim\./s);
  assert.doesNotMatch(sendConfirm({ schedule, message: { text: 'oi' }, groupName: (id) => id }), /class="warnings"/);
  assert.match(scheduleForm({ schedule, messages: [], groups: [] }), /data-role="quiet-hint" hidden/);
});

test('histórico: pulado, adiado e espera pelo freio', () => {
  const at = (s) => new Date(Date.parse('2026-09-12T02:00:00Z') + s * 1000).toISOString();
  const logs = [
    { ts: at(0), status: 'skipped', chatId: '1@g.us', label: 'noturno', message: 'x', reason: 'paused' },
    { ts: at(1), status: 'skipped', chatId: '2@g.us', label: 'noturno', message: 'x', reason: 'paused' },
    { ts: at(120), status: 'sent', chatId: '1@g.us', label: 'ofertas', message: 'x', deferredFrom: '2026-09-11T23:00:00.000Z' },
    { ts: at(130), status: 'sent', chatId: '2@g.us', label: 'ofertas', message: 'x', deferredFrom: '2026-09-11T23:00:00.000Z', waitedMs: 240_000 },
  ].reverse();
  const dispatches = groupDispatches(logs);
  assert.equal(dispatches.length, 2);
  const [ofertas, noturno] = dispatches;
  assert.equal(noturno.skipped, 2);
  assert.equal(noturno.sent, 0);
  assert.equal(noturno.failed, 0);
  assert.equal(ofertas.deferredFrom, '2026-09-11T23:00:00.000Z');
  assert.equal(ofertas.sent, 2);

  const html = historyView({ dispatches, filter: { name: '', onlyFailed: false }, groupName: (id) => id, timeZone: SP, now: NOW });
  assert.match(html, /2 pulados/);
  assert.match(html, /<span class="tag">pulado<\/span>/);
  assert.match(html, /1@g\.us: pulado, envios pausados/);
  assert.match(html, /<span class="tag">adiado<\/span>/);
  // 23:00Z do dia 11 é 20:00 em SP, no mesmo dia de "agora" (23:30 em SP).
  assert.match(html, /Adiado pela janela de silêncio \(era hoje, 20:00\)/);
  assert.match(html, /2@g\.us · esperou 4 min pelo limite por hora/);
  assert.match(html, /2\/2 enviados/);
});

// ---------- App ----------

function routedFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url.split('?')[0]}`];
    if (!handler) throw new Error(`rota não prevista no teste: ${method} ${url}`);
    const [status, payload] = handler(body);
    return { ok: status < 400, status, json: async () => payload };
  };
  return { fetch, calls };
}

const statusBody = (extra = {}) => () => [200, {
  now: new Date().toISOString(), timezone: SP, timezoneLabel: 'Brasília',
  scheduler: { state: 'running', startedAt: null, beatAt: new Date().toISOString(), reloadError: null },
  nextRuns: {}, paused: false, quietHours: null, quietUntil: null, waha: null, ...extra,
}];

function resetState(extra = {}) {
  Object.assign(app.state, {
    schedules: [{ id: 'sch-a', name: 'x', cron: '0 23 * * 1', messageId: 'msg-a', groups: ['1@g.us'], enabled: true }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }], groups: [], groupLists: [], settings: { ...DEFAULTS }, session: null,
    groupsLoaded: true, groupsError: null, logs: [], status: null, statusError: null, clockOffset: 0,
    tab: 'settings', editing: null, sending: false, ...extra,
  });
}

const click = (action, el = {}) => {
  const button = { dataset: { action }, disabled: false, closest: () => null, ...el };
  app.handleClick({ target: { closest: (selector) => (selector === '[data-action]' ? button : null) } });
};

test('salvar ajustes faz PUT com o formulário e atualiza a faixa', async () => {
  const { fetch, calls } = routedFetch({
    'PUT /api/settings': (body) => [200, body],
    'GET /api/status': statusBody({ paused: true }),
    'GET /api/session': () => [200, SESSION],
  });
  installDom(fetch);
  resetState();
  const f = fakeForm(settingsForm({ settings: { ...DEFAULTS, paused: true, hourlyLimit: 30 }, session: SESSION }));
  await app.handleSubmit({ target: f, preventDefault() {} });

  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.paused, true);
  assert.equal(put.body.hourlyLimit, 30);
  assert.equal(app.state.settings.paused, true);
  assert.equal(app.state.status.paused, true, 'a faixa foi atualizada depois de salvar');
});

test('Retomar na faixa faz PUT com paused false; o teste de alerta conta os canais', async () => {
  const { fetch, calls } = routedFetch({
    'PUT /api/settings': (body) => [200, body],
    'POST /api/alerts/test': () => [200, { sent: ['push'] }],
    'GET /api/status': statusBody(),
    'GET /api/session': () => [200, SESSION],
  });
  const $ = installDom(fetch);
  resetState({ settings: { ...DEFAULTS, paused: true }, tab: 'schedules' });

  click('resume-all');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.find((c) => c.method === 'PUT').body.paused, false);
  assert.equal(app.state.settings.paused, false);

  click('alert-test');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === '/api/alerts/test'));
  assert.equal(typeof $('#toasts').append, 'function');
});

test('o modal de envio avisa quando pausado ou na janela', () => {
  const { fetch } = routedFetch({});
  const $ = installDom(fetch);
  resetState({ tab: 'schedules', status: statusBody({ paused: true, quietUntil: '2026-09-12T11:00:00Z' })()[1] });
  click('run', { dataset: { action: 'run', id: 'sch-a' } });
  assert.match($('#modal').innerHTML, /Envios pausados nos ajustes: este envio manual sai mesmo assim\./);
  assert.match($('#modal').innerHTML, /Dentro da janela de silêncio: o envio manual sai agora mesmo assim\./);
});

test('abrir um agendamento cujo horário cai na janela mostra o aviso', async () => {
  const { fetch } = routedFetch({ 'GET /api/cron/preview': () => [200, { valid: true, next: [] }] });
  const $ = installDom(fetch);
  resetState({ tab: 'schedules', status: statusBody({ quietHours: { start: '22:00', end: '08:00' } })()[1] });
  app.openScheduleEditor('sch-a');
  const hint = $('#drawer').querySelector('[data-role="quiet-hint"]');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Dentro da janela de silêncio \(22:00 a 08:00\): o envio sai às 08:00\./);
});
