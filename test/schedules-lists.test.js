// Envio único ("at") e listas de grupos na validação e na leitura do arquivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSchedules, validateSchedule, normalizeStore, validateGroupList, resolveTargets, newId,
} from '../src/schedules.js';

function writeSchedules(content) {
  const path = join(mkdtempSync(join(tmpdir(), 'waha-lists-')), 'schedules.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

const withAt = { name: 'promo', at: '2026-09-13T10:00', messageId: 'msg-a', groups: ['1@g.us'] };

test('newId gera prefixo e oito hexadecimais', () => {
  assert.match(newId('dsp'), /^dsp-[0-9a-f]{8}$/);
});

test('agendamento com "at" no lugar de cron: campos opcionais só aparecem quando existem', () => {
  const s = validateSchedule(withAt);
  assert.equal(s.at, '2026-09-13T10:00');
  assert.equal('cron' in s, false);
  assert.equal('firedAt' in s, false, 'firedAt ausente não entra no objeto');
  assert.equal('groupLists' in s, false, 'groupLists vazio não entra no objeto');
  const repeat = validateSchedule({ ...withAt, at: undefined, cron: '0 9 * * 1' });
  assert.equal('at' in repeat, false);
  assert.equal(repeat.cron, '0 9 * * 1');
});

test('cron e at juntos, ou nenhum dos dois, é erro com o rótulo', () => {
  assert.throws(() => validateSchedule({ ...withAt, cron: '0 9 * * 1' }), /Agendamento "promo": informe "cron".*ou "at"/);
  assert.throws(() => validateSchedule({ name: 'promo', messageId: 'msg-a', groups: ['1@g.us'] }), /informe "cron".*ou "at"/);
});

test('"at" com formato errado ou data inexistente é recusado', () => {
  assert.throws(() => validateSchedule({ ...withAt, at: '13/09/2026 10:00' }), /Agendamento "promo": campo "at"/);
  assert.throws(() => validateSchedule({ ...withAt, at: '2026-02-30T10:00' }), /campo "at"/);
});

test('firedAt e missedAt precisam ser datas ISO e são preservados', () => {
  const s = validateSchedule({ ...withAt, firedAt: '2026-09-13T13:00:05.000Z' });
  assert.equal(s.firedAt, '2026-09-13T13:00:05.000Z');
  assert.throws(() => validateSchedule({ ...withAt, missedAt: 'ontem' }), /campo "missedAt"/);
});

test('groupLists precisa existir e a união vem na ordem, sem repetição', () => {
  const lists = [{ id: 'lst-1', name: 'A', groups: ['2@g.us', '1@g.us', '3@g.us'] }];
  const s = validateSchedule(
    { name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'], groupLists: ['lst-1'] },
    { listIds: new Set(['lst-1']) }
  );
  assert.deepEqual(s.groupLists, ['lst-1']);
  assert.deepEqual(resolveTargets(s, lists), ['1@g.us', '2@g.us', '3@g.us']);
  assert.deepEqual(resolveTargets({ groups: ['9@g.us'] }, lists), ['9@g.us'], 'sem groupLists no objeto');
  assert.throws(
    () => validateSchedule({ ...withAt, groupLists: ['lst-x'] }, { listIds: new Set() }),
    /Agendamento "promo": a lista "lst-x" não existe/
  );
  assert.throws(() => validateSchedule({ ...withAt, groupLists: 'lst-1' }), /campo "groupLists"/);
});

test('groups vazio com lista é válido; sem lista continua erro; sem groups e sem lista herda os defaults', () => {
  const s = validateSchedule({ ...withAt, groups: [], groupLists: ['lst-1'] });
  assert.deepEqual(s.groups, []);
  assert.throws(() => validateSchedule({ ...withAt, groups: [] }), /lista de grupos vazia/);
  const inherited = validateSchedule({ ...withAt, groups: undefined }, { defaultGroups: ['9@g.us'] });
  assert.deepEqual(inherited.groups, ['9@g.us']);
  // Com lista, "groups" ausente NÃO herda os defaults: o usuário escolheu a lista.
  const withList = validateSchedule({ ...withAt, groups: undefined, groupLists: ['lst-1'] }, { defaultGroups: ['9@g.us'] });
  assert.deepEqual(withList.groups, []);
});

test('validateGroupList exige nome e ao menos um grupo, e gera id lst-', () => {
  const list = validateGroupList({ name: ' Ofertas SP ', groups: ['1@g.us', ' 1@g.us', '2@g.us'] });
  assert.match(list.id, /^lst-[0-9a-f]{8}$/);
  assert.equal(list.name, 'Ofertas SP');
  assert.deepEqual(list.groups, ['1@g.us', '2@g.us']);
  assert.throws(() => validateGroupList({ groups: ['1@g.us'] }, 0), /Lista de grupos #1: campo "name"/);
  assert.throws(() => validateGroupList({ name: 'Vazia', groups: [] }), /Lista de grupos "Vazia": selecione ao menos um grupo/);
  assert.throws(() => validateGroupList({ name: 'Sem', groups: 'x' }), /campo "groups"/);
});

test('normalizeStore devolve groupLists e recusa nome ou id de lista duplicado', () => {
  const store = normalizeStore({
    version: 2,
    groupLists: [{ id: 'lst-1', name: 'A', groups: ['1@g.us'] }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá' }],
    schedules: [{ id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-1'] }],
  });
  assert.deepEqual(store.groupLists, [{ id: 'lst-1', name: 'A', groups: ['1@g.us'] }]);
  assert.deepEqual(store.schedules[0].groupLists, ['lst-1']);

  const dupName = { groupLists: [{ name: 'A', groups: ['1@g.us'] }, { name: 'A', groups: ['2@g.us'] }] };
  assert.throws(() => normalizeStore(dupName), /Lista de grupos "A": nome duplicado/);
  const dupId = { groupLists: [{ id: 'lst-1', name: 'A', groups: ['1@g.us'] }, { id: 'lst-1', name: 'B', groups: ['2@g.us'] }] };
  assert.throws(() => normalizeStore(dupId), /Lista de grupos "lst-1": id duplicado/);
  // Arquivo sem o campo: lista vazia, sem erro.
  assert.deepEqual(normalizeStore({ schedules: [] }).groupLists, []);
});

test('normalizeStore recusa agendamento cuja lista não existe', () => {
  assert.throws(() => normalizeStore({
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá' }],
    schedules: [{ name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: [], groupLists: ['lst-nope'] }],
  }), /a lista "lst-nope" não existe/);
});

test('loadSchedules devolve targets resolvidos com as listas', () => {
  const path = writeSchedules({
    version: 2,
    groupLists: [{ id: 'lst-1', name: 'A', groups: ['2@g.us', '3@g.us'] }],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá' }],
    schedules: [
      { id: 'sch-a', name: 'x', cron: '0 9 * * 1', messageId: 'msg-a', groups: ['3@g.us', '1@g.us'], groupLists: ['lst-1'] },
      { id: 'sch-b', name: 'y', at: '2026-09-13T10:00', messageId: 'msg-a', groups: ['5@g.us'] },
    ],
  });
  const { schedules } = loadSchedules(path);
  assert.deepEqual(schedules[0].targets, ['3@g.us', '1@g.us', '2@g.us']);
  assert.deepEqual(schedules[1].targets, ['5@g.us']);
  assert.equal(schedules[1].at, '2026-09-13T10:00');
});
