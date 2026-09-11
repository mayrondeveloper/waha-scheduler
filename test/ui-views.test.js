import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleList, scheduleForm, formCron, formGroups, sendConfirm, sendResult, searchKey, selectedCountLabel,
  schedulesSubtitle,
} from '../public/schedules-view.js';
import { messageList, messageEditor, emojiPanel, messagesSubtitle } from '../public/messages-view.js';
import { historyView, historySubtitle } from '../public/history-view.js';
import { groupDispatches, lastDispatchByName } from '../public/history.js';
import { pageHeader } from '../public/html.js';
import { mediaPreview, mediaChip, formatBytes, validateFile } from '../public/media.js';
import { fakeForm } from './fake-dom.js';

const KNOWN_GROUP = '111111111111111111@g.us';
const SAVED_UNKNOWN_GROUP = '777777777777777777@g.us';
const ALPHA = { id: KNOWN_GROUP, name: 'Grupo Alpha' };
const MESSAGES = [{ id: 'msg-a', name: 'Oi', text: 'Olá, *grupo*!' }];
const NOW = Date.parse('2026-09-11T18:00:00Z');
const SP = 'America/Sao_Paulo';

function form({ groups = [ALPHA], saved = [KNOWN_GROUP], cron = '0 9 * * 1', messages = MESSAGES, composing = false } = {}) {
  return scheduleForm({
    schedule: { id: 'sch-a', name: 'bom-dia', cron, messageId: 'msg-a', groups: saved, enabled: true },
    messages,
    groups,
    composing,
  });
}

// ---------- Formulário de agendamento (migrados de ui-app.test.js) ----------

test('grupo salvo que o WAHA não lista aparece no formulário, marcado e sinalizado', () => {
  const html = form({ saved: [SAVED_UNKNOWN_GROUP] });
  assert.ok(html.includes(`value="${SAVED_UNKNOWN_GROUP}"`), 'o grupo salvo tem que estar no formulário mesmo fora da lista do WAHA');
  assert.match(html, /não encontrado na lista atual do WAHA/, 'o grupo fora da lista tem que estar visivelmente sinalizado');
  assert.ok(html.includes(KNOWN_GROUP), 'os grupos listados pelo WAHA continuam aparecendo');
});

// O bug que este teste prende: com o grupo salvo ausente do formulário,
// formGroups() devolvia [] e a API trocava a lista vazia por defaultGroups —
// um PUT que só mudaria o nome levava a mensagem para outro grupo, calado.
test('salvar sem mexer nos grupos preserva o destino salvo que o WAHA não lista', () => {
  assert.deepEqual(formGroups(fakeForm(form({ saved: [SAVED_UNKNOWN_GROUP] }))), [SAVED_UNKNOWN_GROUP]);
});

test('grupo listado pelo WAHA e não salvo continua desmarcado', () => {
  const groups = [ALPHA, { id: '222222222222222222@g.us', name: 'Grupo Beta' }];
  assert.deepEqual(formGroups(fakeForm(form({ groups, saved: [KNOWN_GROUP] }))), [KNOWN_GROUP]);
});

test('agendamento novo sem grupos não marca nada', () => {
  const html = scheduleForm({ schedule: { messageId: 'msg-a', groups: [] }, messages: MESSAGES, groups: [ALPHA] });
  assert.deepEqual(formGroups(fakeForm(html)), []);
});

test('com o WAHA fora do ar, o campo livre já vem com os ids salvos', () => {
  const html = form({ groups: [], saved: [SAVED_UNKNOWN_GROUP, KNOWN_GROUP] });
  assert.ok(html.includes('id="groups-text"'), 'sem lista do WAHA, o campo livre é a saída');
  assert.deepEqual(formGroups(fakeForm(html)), [SAVED_UNKNOWN_GROUP, KNOWN_GROUP]);
});

test('agendamento salvo abre com os dias marcados e o horário preenchido', () => {
  const f = fakeForm(form({ cron: '30 8 * * 1,3' }));
  assert.deepEqual(f.querySelectorAll('input[name="day"]:checked').map((i) => i.value), ['1', '3']);
  assert.equal(f.querySelector('input[name="time"]').value, '08:30');
  assert.equal(f.querySelector('input[name="cron"]'), null, 'cron de dias e horário não mostra o campo cru');
});

test('salvar sem mexer mantém o mesmo cron de dias e horário', () => {
  assert.equal(formCron(fakeForm(form({ cron: '30 8 * * 1,3' }))), '30 8 * * 1,3');
});

// Um cron editado à mão que não cabe em dias e horário não pode ser trocado
// por outro em silêncio só porque o usuário abriu e salvou o agendamento.
test('cron personalizado aparece como está, sinalizado, e salvar sem mexer o mantém', () => {
  const html = form({ cron: '*/15 * * * *' });
  assert.match(html, /cron personalizado/i, 'o usuário tem que ver por que não há dias e horário');
  assert.equal(formCron(fakeForm(html)), '*/15 * * * *');
});

test('agendamento novo abre sem dia marcado e sem horário', () => {
  const f = fakeForm(scheduleForm({ schedule: { messageId: 'msg-a', groups: [] }, messages: MESSAGES, groups: [] }));
  assert.equal(f.querySelectorAll('input[name="day"]:checked').length, 0);
  assert.equal(f.querySelector('input[name="time"]').value, '');
  assert.equal(formCron(f), '', 'sem dia nem horário não sai cron');
});

test('sem nenhum dia marcado não sai cron, mesmo com horário', () => {
  const f = {
    querySelector: (selector) => (selector === 'input[name="time"]' ? { value: '09:00' } : null),
    querySelectorAll: () => [],
  };
  assert.equal(formCron(f), '');
});

test('a lista mostra quando dispara por extenso e o cron personalizado cru', () => {
  const html = scheduleList({
    schedules: [
      { id: 'a', name: 'semana', cron: '0 9 * * 1-5', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
      { id: 'b', name: 'quinze', cron: '*/15 * * * *', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
    ],
    messages: MESSAGES,
  });
  assert.match(html, /Seg, Ter, Qua, Qui e Sex às 09:00/);
  assert.match(html, /<code>\*\/15 \* \* \* \*<\/code>/);
});

// ---------- Novos ----------

test('a lista mostra o próximo envio por extenso, os grupos por nome e o badge de estado', () => {
  const html = scheduleList({
    schedules: [
      { id: 'a', name: 'resumo', cron: '0 18 * * 5', messageId: 'msg-a', groups: [KNOWN_GROUP], enabled: true },
      { id: 'b', name: 'live', cron: '30 19 * * 3', messageId: 'msg-a', groups: [KNOWN_GROUP, '2@g.us'], enabled: false },
    ],
    messages: MESSAGES,
    nextRuns: { a: '2026-09-11T21:00:00Z' },
    timeZone: SP,
    now: NOW,
    groupName: (id) => (id === KNOWN_GROUP ? 'Grupo Alpha' : id),
  });
  assert.match(html, /Próximo: <strong>hoje, 18:00<\/strong>/);
  assert.match(html, /badge tone-active/);
  assert.match(html, /Ativo</);
  assert.match(html, /badge tone-paused/);
  assert.match(html, /Pausado</);
  assert.match(html, /Próximo: —/, 'agendamento pausado não tem próximo envio');
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /2 grupos · Grupo Alpha, 2@g\.us/);
  assert.match(html, /1 grupo · Grupo Alpha/);
});

test('agendamento cujo último envio falhou ganha o badge e a linha da falha', () => {
  const dispatches = groupDispatches([
    { ts: '2026-09-11T12:00:13Z', status: 'error', chatId: '2@g.us', label: 'ofertas', error: 'Erro 500 ao enviar' },
    { ts: '2026-09-11T12:00:02Z', status: 'sent', chatId: KNOWN_GROUP, label: 'ofertas' },
  ]);
  const html = scheduleList({
    schedules: [{ id: 'a', name: 'ofertas', cron: '0 9 * * 1-5', messageId: 'msg-a', groups: [KNOWN_GROUP, '2@g.us'], enabled: true }],
    messages: MESSAGES,
    nextRuns: { a: '2026-09-14T12:00:00Z' },
    timeZone: SP,
    now: NOW,
    lastDispatches: lastDispatchByName(dispatches),
  });
  assert.match(html, /badge tone-error/);
  assert.match(html, /Falha no envio</);
  assert.match(html, /Último envio falhou · Erro 500 ao enviar · hoje, 09:00/);
  assert.doesNotMatch(html, /Ativo</);
});

test('cabeçalho da aba: título, contagem e ação', () => {
  const html = pageHeader({ title: 'Agendamentos', subtitle: '3 agendamentos · 1 ativo', action: '<button>Novo</button>' });
  assert.match(html, /<h2 class="page-title">Agendamentos<\/h2>/);
  assert.match(html, /3 agendamentos · 1 ativo/);
  assert.match(html, /<button>Novo<\/button>/);
  assert.doesNotMatch(pageHeader({ title: '<b>x</b>', subtitle: '<i>y</i>' }), /<b>|<i>/, 'título e subtítulo são escapados');

  assert.equal(schedulesSubtitle([{ enabled: true }, { enabled: false }, { enabled: true }]), '3 agendamentos · 2 ativos');
  assert.equal(schedulesSubtitle([{ enabled: false }]), '1 agendamento · nenhum ativo');
  assert.equal(schedulesSubtitle([{ enabled: true }]), '1 agendamento · 1 ativo');
  assert.equal(schedulesSubtitle([]), 'Nenhum agendamento');
  assert.equal(messagesSubtitle([{}, {}]), '2 mensagens');
  assert.equal(messagesSubtitle([{}]), '1 mensagem');
  assert.equal(messagesSubtitle([]), 'Nenhuma mensagem');
  assert.equal(historySubtitle([{ failed: 0 }, { failed: 2 }]), '2 disparos · 1 com falha');
  assert.equal(historySubtitle([{ failed: 0 }]), '1 disparo');
  assert.equal(historySubtitle([]), 'Nenhum disparo');
});

test('lista vazia convida a criar o primeiro agendamento', () => {
  assert.match(scheduleList({ schedules: [], messages: [] }), /Crie seu primeiro agendamento/);
});

test('nome com HTML é escapado na lista e no formulário', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const schedule = { id: 'a', name: evil, cron: '0 9 * * 1', messageId: 'msg-a', groups: [], enabled: true };
  assert.doesNotMatch(scheduleList({ schedules: [schedule], messages: MESSAGES }), /<img/);
  assert.doesNotMatch(scheduleForm({ schedule, messages: MESSAGES, groups: [] }), /<img/);
});

test('"Escrever nova" troca a seleção pelo editor, com o nome do agendamento', () => {
  const f = fakeForm(form({ composing: true }));
  assert.equal(f.querySelector('[name="messageId"]'), null, 'sem seleção de mensagem existente');
  assert.equal(f.querySelector('[name="messageName"]').value, 'bom-dia');
  assert.equal(f.querySelector('[name="messageText"]').value, '');
});

test('sem nenhuma mensagem salva, o formulário já abre no editor', () => {
  const f = fakeForm(scheduleForm({ schedule: { name: '', groups: [] }, messages: [], groups: [] }));
  assert.ok(f.querySelector('[name="messageText"]'));
});

test('a mensagem escolhida aparece formatada no balão', () => {
  assert.match(form(), /Olá, <strong>grupo<\/strong>!/);
});

test('o nome do fuso aparece junto dos próximos envios', () => {
  const html = scheduleForm({
    schedule: { name: '', cron: '0 9 * * 1', groups: [] }, messages: MESSAGES, groups: [],
    timezoneLabel: 'Horário Padrão de Brasília',
  });
  assert.match(html, /Horário Padrão de Brasília/);
  assert.match(html, /id="preview"/);
});

test('busca de grupos ignora maiúsculas e acentos; contador no singular e no plural', () => {
  assert.equal(searchKey('Leitores de São Paulo'), 'leitores de sao paulo');
  assert.equal(selectedCountLabel(1), '1 selecionado');
  assert.equal(selectedCountLabel(3), '3 selecionados');
});

test('confirmação de envio mostra a mensagem, os grupos por nome e quantos vão receber', () => {
  const html = sendConfirm({
    schedule: { id: 'sch-a', name: 'bom-dia', groups: [KNOWN_GROUP, SAVED_UNKNOWN_GROUP] },
    message: MESSAGES[0],
    groupName: (id) => (id === KNOWN_GROUP ? 'Grupo Alpha' : id),
  });
  assert.match(html, /Enviar "bom-dia" agora\?/);
  assert.match(html, /Olá, <strong>grupo<\/strong>!/);
  assert.match(html, /Grupo Alpha/);
  assert.match(html, /Enviar para 2 grupos/);
});

test('resultado do envio lista cada falha com o erro', () => {
  const html = sendResult({
    schedule: { name: 'bom-dia' },
    result: {
      sent: 1,
      failed: 1,
      results: [
        { chatId: KNOWN_GROUP, status: 'sent' },
        { chatId: SAVED_UNKNOWN_GROUP, status: 'error', error: 'Erro 500 ao enviar' },
      ],
    },
    groupName: (id) => id,
  });
  assert.match(html, /Enviado para 1 de 2 grupos/);
  assert.match(html, /777777777777777777@g\.us<\/strong>: Erro 500 ao enviar/);
});

test('mensagens mostram quem as usa e quais não são usadas', () => {
  const html = messageList({
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá' }, { id: 'msg-b', name: 'Tchau', text: 'Até' }],
    schedules: [{ id: 'a', name: 'bom-dia', messageId: 'msg-a' }],
  });
  assert.match(html, /Usada por bom-dia/);
  assert.match(html, /Não usada/);
});

test('o editor traz a barra de formatação completa e a prévia do texto', () => {
  const html = messageEditor({ nameField: 'name', textField: 'text', name: 'Oi', text: '*oi*' });
  for (const format of ['bold', 'italic', 'strike', 'mono', 'bullet', 'numbered', 'quote', 'emoji']) {
    assert.ok(html.includes(`data-format="${format}"`), `falta o botão ${format}`);
  }
  assert.match(html, /<strong>oi<\/strong>/);
});

test('seletor de emojis: recentes vazio explica; categoria mostra os emojis', () => {
  assert.match(emojiPanel({ active: 'recent', recents: [] }), /Os emojis que você usar aparecem aqui/);
  assert.match(emojiPanel({ active: 'objects', recents: [] }), /data-emoji="📚"/);
});

test('histórico: disparo com falha já vem aberto, com o erro de cada grupo', () => {
  const logs = [
    { ts: '2026-09-11T12:00:08Z', status: 'error', chatId: '2@g.us', label: 'ofertas', error: 'sessão desconectada' },
    { ts: '2026-09-11T12:00:02Z', status: 'sent', chatId: '1@g.us', label: 'ofertas' },
    { ts: '2026-09-10T02:39:50Z', status: 'sent', chatId: '1@g.us', label: 'Teste (manual)' },
  ];
  const html = historyView({
    dispatches: groupDispatches(logs),
    filter: { name: '', onlyFailed: false },
    groupName: (id) => (id === '1@g.us' ? 'Grupo Alpha' : id),
    timeZone: SP,
    now: NOW,
  });
  assert.equal(html.match(/ open>/g).length, 1, 'só o disparo com falha abre sozinho');
  assert.match(html, /1\/2 enviados/);
  assert.match(html, /1\/1 enviados/);
  assert.match(html, /2@g\.us: sessão desconectada/);
  assert.match(html, /class="tag">manual</);
});

test('histórico filtra por agendamento e por falha', () => {
  const dispatches = groupDispatches([
    { ts: '2026-09-11T12:00:00Z', status: 'sent', chatId: '1@g.us', label: 'ofertas' },
    { ts: '2026-09-11T13:00:00Z', status: 'error', chatId: '1@g.us', label: 'resumo', error: 'x' },
  ]);
  const view = (filter) => historyView({ dispatches, filter, groupName: (id) => id, timeZone: SP, now: NOW });
  const onlyFailed = view({ name: '', onlyFailed: true });
  assert.match(onlyFailed, /row-title-text">resumo/);
  assert.doesNotMatch(onlyFailed, /row-title-text">ofertas/);
  assert.doesNotMatch(view({ name: 'ofertas', onlyFailed: false }), /row-title-text">resumo/);
});

// ---------- Anexos ----------

const IMAGE = { id: 'med-1', filename: 'foto.png', mimetype: 'image/png', size: 183420, kind: 'image' };

test('editor com anexo mostra a tira com nome, tamanho e remover, e a imagem no balão', () => {
  const html = messageEditor({ nameField: 'name', textField: 'text', text: 'oi', media: IMAGE, mediaSrc: '/api/media/med-1' });
  assert.match(html, /data-format="attach"/, 'botão Anexar na barra');
  assert.match(html, /type="file"/);
  assert.match(html, /foto\.png/);
  assert.match(html, /179 KB/);
  assert.match(html, /data-action="remove-media"/);
  assert.match(html, /<img[^>]+src="\/api\/media\/med-1"/);
  assert.doesNotMatch(messageEditor({ nameField: 'name', textField: 'text' }), /remove-media/, 'sem anexo, sem tira');
});

test('prévia do anexo por tipo, sempre com o nome escapado', () => {
  assert.match(mediaPreview({ ...IMAGE, kind: 'video', mimetype: 'video/mp4' }, 'blob:v'), /<video[^>]+src="blob:v"/);
  assert.match(mediaPreview({ ...IMAGE, kind: 'audio', mimetype: 'audio/mpeg' }, 'blob:a'), /<audio[^>]+src="blob:a"/);
  const doc = mediaPreview({ ...IMAGE, filename: '<b>x</b>.pdf', kind: 'document', mimetype: 'application/pdf' }, '/api/media/med-1');
  assert.match(doc, /media-doc/);
  assert.match(doc, /&lt;b&gt;x&lt;\/b&gt;\.pdf/);
  assert.doesNotMatch(doc, /<b>/);
});

test('chip do anexo, tamanhos por extenso e validação do arquivo', () => {
  assert.match(mediaChip(IMAGE), /media-chip/);
  assert.match(mediaChip(IMAGE), /foto\.png/);
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(183420), '179 KB');
  assert.equal(formatBytes(1_258_291), '1,2 MB');
  assert.equal(validateFile({ name: 'a.png', size: 10 }), null);
  assert.match(validateFile({ name: 'grande.mp4', size: 17 * 1024 * 1024 }), /16 MB/);
});

test('a lista de mensagens, a seleção no agendamento e o modal de envio mostram o anexo', () => {
  const withMedia = [{ id: 'msg-a', name: 'Foto', text: 'Olá', media: IMAGE }];
  assert.match(messageList({ messages: withMedia, schedules: [] }), /media-chip/);
  const formHtml = scheduleForm({ schedule: { id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [] }, messages: withMedia, groups: [] });
  assert.match(formHtml, /src="\/api\/media\/med-1"/, 'a prévia da mensagem escolhida traz a imagem');
  const confirm = sendConfirm({ schedule: { id: 'sch-a', name: 'x', groups: [KNOWN_GROUP] }, message: withMedia[0], groupName: (id) => id });
  assert.match(confirm, /src="\/api\/media\/med-1"/);
});

test('histórico vazio explica de onde vêm os envios', () => {
  const html = historyView({ dispatches: [], filter: { name: '', onlyFailed: false }, groupName: (id) => id });
  assert.match(html, /Nenhum envio registrado/);
});
