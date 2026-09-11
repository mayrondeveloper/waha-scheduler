import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_MEDIA_BYTES, classifyMedia, safeExtension, mediaDirFor, saveMedia, mediaPath, removeMedia, readMediaBase64,
} from '../src/media.js';
import { validateMessage, loadSchedules } from '../src/schedules.js';

// PNG de 1 pixel, o menor anexo de verdade que existe.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const newDir = () => mkdtempSync(join(tmpdir(), 'waha-media-'));

// ---------- src/media.js ----------

test('classifica o anexo pelo mimetype', () => {
  assert.equal(classifyMedia('image/jpeg'), 'image');
  assert.equal(classifyMedia('image/png'), 'image');
  assert.equal(classifyMedia('image/webp'), 'image');
  assert.equal(classifyMedia('image/gif'), 'document', 'GIF vai como arquivo: o WhatsApp o trata como vídeo');
  assert.equal(classifyMedia('video/mp4'), 'video');
  assert.equal(classifyMedia('audio/mpeg'), 'audio');
  assert.equal(classifyMedia('audio/ogg'), 'audio');
  assert.equal(classifyMedia('application/pdf'), 'document');
  assert.equal(classifyMedia('application/octet-stream'), 'document');
});

test('a extensão segura vem do nome original, minúscula e só alfanumérica', () => {
  assert.equal(safeExtension('Foto.JPG'), 'jpg');
  assert.equal(safeExtension('a.b/../c'), 'bin', 'só o último segmento conta, e "c" não tem extensão');
  assert.equal(safeExtension('../../etc/passwd.PNG'), 'png');
  assert.equal(safeExtension('semext'), 'bin');
  assert.equal(safeExtension('x.tar.gz'), 'gz');
  assert.equal(safeExtension('arquivo.extensaolonga'), 'bin');
});

test('a pasta de mídia fica ao lado do arquivo de agendamentos', () => {
  assert.equal(mediaDirFor('/x/data/schedules.json'), join('/x/data', 'media'));
});

test('grava o anexo e devolve os metadados', () => {
  const dir = newDir();
  const media = saveMedia(dir, { filename: 'pixel.png', mimetype: 'image/png', data: PNG });
  assert.match(media.id, /^med-[0-9a-f]{8}$/);
  assert.equal(media.filename, 'pixel.png');
  assert.equal(media.mimetype, 'image/png');
  assert.equal(media.kind, 'image');
  assert.equal(media.size, Buffer.from(PNG, 'base64').length);
  assert.ok(mediaPath(dir, media).endsWith(`${media.id}.png`));
  assert.ok(existsSync(mediaPath(dir, media)));
  assert.equal(readMediaBase64(dir, media), PNG);
});

test('recusa anexo inválido sem deixar arquivo', () => {
  const dir = newDir();
  const ok = { filename: 'pixel.png', mimetype: 'image/png', data: PNG };
  assert.throws(() => saveMedia(dir, { ...ok, data: '***' }), /base64/);
  assert.throws(() => saveMedia(dir, { ...ok, data: '' }), /vazio/);
  assert.throws(() => saveMedia(dir, { ...ok, mimetype: 'png' }), /mimetype/);
  assert.throws(() => saveMedia(dir, { ...ok, filename: '  ' }), /nome/);
  assert.throws(() => saveMedia(dir, ok, { maxBytes: 10 }), /passa do limite/);
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
});

test('removeMedia apaga e tolera ausente; readMediaBase64 nomeia o anexo que falta', () => {
  const dir = newDir();
  const media = saveMedia(dir, { filename: 'pixel.png', mimetype: 'image/png', data: PNG });
  removeMedia(dir, media);
  assert.equal(existsSync(mediaPath(dir, media)), false);
  removeMedia(dir, media);
  assert.throws(() => readMediaBase64(dir, media), /Anexo não encontrado: pixel\.png/);
});

test('o limite é o teto do WhatsApp para mídia', () => {
  assert.equal(MAX_MEDIA_BYTES, 16 * 1024 * 1024);
});

// ---------- media na mensagem (src/schedules.js) ----------

const MEDIA = { id: 'med-12345678', filename: 'pixel.png', mimetype: 'image/png', size: 68, kind: 'image' };

test('validateMessage aceita media válido e não inventa o campo quando ausente ou nulo', () => {
  assert.deepEqual(validateMessage({ id: 'msg-a', name: 'Oi', text: 'x', media: MEDIA }).media, MEDIA);
  assert.equal('media' in validateMessage({ id: 'msg-a', name: 'Oi', text: 'x' }), false);
  assert.equal('media' in validateMessage({ id: 'msg-a', name: 'Oi', text: 'x', media: null }), false);
});

test('validateMessage recusa media malformado', () => {
  const bad = [
    { ...MEDIA, id: '' },
    { ...MEDIA, filename: 3 },
    { ...MEDIA, mimetype: '' },
    { ...MEDIA, size: 'x' },
    { ...MEDIA, kind: 'sticker' },
    'texto',
  ];
  for (const media of bad) {
    assert.throws(() => validateMessage({ name: 'Oi', text: 'x', media }), /Mensagem "Oi": campo "media"/, JSON.stringify(media));
  }
});

test('loadSchedules devolve o anexo junto do texto', () => {
  const path = join(newDir(), 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [
      { id: 'msg-a', name: 'Oi', text: 'Olá', media: MEDIA },
      { id: 'msg-b', name: 'Tchau', text: 'Até' },
    ],
    schedules: [
      { id: 'sch-a', name: 'a', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'b', cron: '0 9 * * 2', messageId: 'msg-b' },
    ],
  }));
  const { schedules } = loadSchedules(path);
  assert.deepEqual(schedules[0].media, MEDIA);
  assert.equal(schedules[0].message, 'Olá');
  assert.equal(schedules[1].media, null);
});
