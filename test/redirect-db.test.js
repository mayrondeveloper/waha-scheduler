// Banco do redirecionador. Pula quando o Node não tem node:sqlite (o
// redirecionador exige Node 24; o resto do projeto não).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sqlite = await import('node:sqlite').catch(() => null);
const skip = sqlite ? false : 'node:sqlite indisponível neste Node';
const { openDb } = sqlite ? await import('../src/redirect/db.js') : {};

const NOW = Date.parse('2026-09-12T12:00:00Z');
const INPUT = {
  dispatchId: 'dsp-1',
  schedule: { id: 'sch-a', name: 'Ofertas da manhã' },
  groups: [{ id: '1@g.us', name: 'Grupo Alpha' }, { id: '2@g.us', name: 'Grupo Beta' }],
  urls: ['https://loja.exemplo/p?tag=x', 'https://outra.exemplo/'],
  utm: true,
};

function newDb(t) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'waha-redirect-')), 'clicks.sqlite'));
  t.after(() => db.close());
  return db;
}

test('conta: a chave sai uma vez, fica guardada como hash e identifica a conta', { skip }, (t) => {
  const db = newDb(t);
  const account = db.createAccount('Compara Livros');
  assert.match(account.key, /^[0-9A-Za-z]{32}$/);
  assert.deepEqual(db.accountByKey(account.key), { id: account.id, name: 'Compara Livros' });
  assert.equal(db.accountByKey('errada'), null);
  assert.equal(db.accountByKey(''), null);
});

test('links por (grupo, URL) com UTM e redirecionamento pelo código', { skip }, (t) => {
  const db = newDb(t);
  const { id } = db.createAccount('x');
  const links = db.createLinks(id, INPUT, { publicUrl: 'https://go.exemplo/', creatorIpHash: 'criador', now: NOW });
  assert.deepEqual(Object.keys(links), ['1@g.us', '2@g.us']);
  assert.equal(Object.keys(links['1@g.us']).length, 2);
  const short = links['1@g.us']['https://loja.exemplo/p?tag=x'];
  assert.match(short, /^https:\/\/go\.exemplo\/r\/[0-9A-Za-z]{10}$/);

  const link = db.linkByCode(short.split('/r/')[1]);
  assert.equal(link.group_id, '1@g.us');
  assert.equal(link.dispatch_id, 'dsp-1');
  assert.equal(link.creator_ip_hash, 'criador');
  assert.equal(link.created_at, new Date(NOW).toISOString());
  const final = new URL(link.final_url);
  assert.equal(final.searchParams.get('tag'), 'x');
  assert.equal(final.searchParams.get('utm_campaign'), 'ofertas-da-manha');
  assert.equal(final.searchParams.get('utm_content'), 'grupo-alpha');
  assert.equal(db.linkByCode('nao-existe'), null);

  const plain = db.createLinks(id, { ...INPUT, dispatchId: 'dsp-2', utm: false }, { publicUrl: 'https://go.exemplo', creatorIpHash: null });
  const code = plain['2@g.us']['https://outra.exemplo/'].split('/r/')[1];
  assert.equal(db.linkByCode(code).final_url, 'https://outra.exemplo/', 'sem UTM o destino é o original');
});

test('só o clique humano conta; único é por visitante; totais por disparo e por grupo', { skip }, (t) => {
  const db = newDb(t);
  const { id } = db.createAccount('x');
  const links = db.createLinks(id, INPUT, { publicUrl: 'https://go.exemplo', creatorIpHash: null, now: NOW });
  const codeA = links['1@g.us']['https://loja.exemplo/p?tag=x'].split('/r/')[1];
  const codeB = links['2@g.us']['https://loja.exemplo/p?tag=x'].split('/r/')[1];

  assert.deepEqual(db.recordClick(codeA, { kind: 'human', visitorHash: 'v1', now: NOW }), { unique: true });
  assert.deepEqual(db.recordClick(codeA, { kind: 'human', visitorHash: 'v1', now: NOW + 1000 }), { unique: false });
  assert.deepEqual(db.recordClick(codeA, { kind: 'human', visitorHash: 'v2', now: NOW + 2000 }), { unique: true });
  db.recordClick(codeA, { kind: 'bot', visitorHash: 'b1', now: NOW });
  db.recordClick(codeA, { kind: 'preview', visitorHash: 'p1', now: NOW });
  db.recordClick(codeB, { kind: 'human', visitorHash: 'v1', now: NOW });

  assert.deepEqual(db.clicksByDispatch(id, 'dsp-1'), {
    clicks: 4, unique: 3,
    groups: { '1@g.us': { clicks: 3, unique: 2 }, '2@g.us': { clicks: 1, unique: 1 } },
  });
  assert.deepEqual(db.clicksByDispatch(id, 'dsp-nada'), { clicks: 0, unique: 0, groups: {} });
  assert.deepEqual(db.clicksByDispatch(id + 1, 'dsp-1'), { clicks: 0, unique: 0, groups: {} }, 'outra conta não vê');
});

test('sal do dia é criado uma vez e persiste; purga apaga cliques antigos e mantém os totais', { skip }, (t) => {
  const db = newDb(t);
  const salt = db.daySalt('2026-09-12');
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.equal(db.daySalt('2026-09-12'), salt);
  assert.notEqual(db.daySalt('2026-09-13'), salt);

  const { id } = db.createAccount('x');
  const links = db.createLinks(id, INPUT, { publicUrl: 'https://go.exemplo', creatorIpHash: null, now: NOW });
  const code = links['1@g.us']['https://outra.exemplo/'].split('/r/')[1];
  db.recordClick(code, { kind: 'human', visitorHash: 'v1', now: NOW - 200 * 86_400_000 });
  db.recordClick(code, { kind: 'human', visitorHash: 'v2', now: NOW });
  assert.equal(db.purgeClicksBefore(new Date(NOW - 180 * 86_400_000).toISOString()), 1);
  assert.deepEqual(db.clicksByDispatch(id, 'dsp-1').groups['1@g.us'], { clicks: 2, unique: 2 });
});
