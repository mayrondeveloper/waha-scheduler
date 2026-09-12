import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAlert } from '../src/alerts.js';

const cfg = { wahaUrl: 'http://localhost:0', session: 'default', apiKey: '' };
const me = { id: '5511999999999@c.us', pushName: 'Dono' };

function fakeClient(fail = false) {
  const calls = [];
  return { calls, async sendText(chatId, text) { calls.push({ chatId, text }); if (fail) throw new Error('Erro 500 ao enviar'); return {}; } };
}

function fakeFetch(status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status }; };
  return { calls, fetchImpl };
}

test('WhatsApp vai para o número da sessão com o título em negrito; push faz POST em texto com o cabeçalho Title', async () => {
  const client = fakeClient();
  const push = fakeFetch();
  const settings = { alerts: { whatsapp: true, pushUrl: 'https://ntfy.sh/topico' } };
  const sent = await sendAlert({ title: 'Número reconectado', text: 'A sessão voltou.', channels: ['whatsapp', 'push'] },
    { settings, cfg, client, me, fetchImpl: push.fetchImpl });

  assert.deepEqual(sent, ['whatsapp', 'push']);
  assert.deepEqual(client.calls, [{ chatId: me.id, text: '*Número reconectado*\nA sessão voltou.' }]);
  assert.equal(push.calls[0].url, 'https://ntfy.sh/topico');
  assert.equal(push.calls[0].init.method, 'POST');
  assert.equal(push.calls[0].init.headers.Title, 'Número reconectado');
  assert.equal(push.calls[0].init.body, 'A sessão voltou.');
});

test('canal desligado, sem URL ou sem "me" não manda nada', async () => {
  const client = fakeClient();
  const push = fakeFetch();
  const off = { alerts: { whatsapp: false, pushUrl: '' } };
  assert.deepEqual(await sendAlert({ title: 't', text: 'x', channels: ['whatsapp', 'push'] }, { settings: off, cfg, client, me, fetchImpl: push.fetchImpl }), []);
  assert.equal(client.calls.length, 0);
  assert.equal(push.calls.length, 0);

  const on = { alerts: { whatsapp: true, pushUrl: 'https://ntfy.sh/t' } };
  assert.deepEqual(await sendAlert({ title: 't', text: 'x', channels: ['whatsapp'] }, { settings: on, cfg, client, me: null, fetchImpl: push.fetchImpl }), [], 'sem me não há destino');
  assert.deepEqual(await sendAlert({ title: 't', text: 'x', channels: ['push'] }, { settings: on, cfg, client, me, fetchImpl: push.fetchImpl }), ['push'], 'só o canal pedido');
  assert.equal(client.calls.length, 0);
});

test('falha num canal não lança nem impede o outro', async () => {
  const client = fakeClient(true);
  const push = fakeFetch(500);
  const settings = { alerts: { whatsapp: true, pushUrl: 'https://ntfy.sh/t' } };
  const sent = await sendAlert({ title: 't', text: 'x', channels: ['whatsapp', 'push'] }, { settings, cfg, client, me, fetchImpl: push.fetchImpl });
  assert.deepEqual(sent, []);

  const boom = async () => { throw new Error('rede caiu'); };
  assert.deepEqual(await sendAlert({ title: 't', text: 'x', channels: ['push'] }, { settings, cfg, client, me, fetchImpl: boom }), []);
});
