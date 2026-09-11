import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWhatsApp, toggleInline, toggleMonospace, toggleLinePrefix, insertText,
} from '../public/whatsapp.js';

const line = (html) => `<div class="wa-line">${html}</div>`;
const bullet = (mark, html) => `<div class="wa-li"><span class="wa-mark">${mark}</span><span>${html}</span></div>`;

test('negrito, itálico e tachado', () => {
  assert.equal(formatWhatsApp('*oi*'), line('<strong>oi</strong>'));
  assert.equal(formatWhatsApp('_oi_'), line('<em>oi</em>'));
  assert.equal(formatWhatsApp('~oi~'), line('<s>oi</s>'));
  assert.equal(formatWhatsApp('um *dois* três'), line('um <strong>dois</strong> três'));
});

test('marcador que não está colado na palavra não formata, como no WhatsApp', () => {
  // No começo da linha, "* " é lista; no meio, espaço dentro dos asteriscos
  // não formata.
  assert.equal(formatWhatsApp('a * oi * b'), line('a * oi * b'));
  assert.equal(formatWhatsApp('2*3*4'), line('2*3*4'));
  assert.equal(formatWhatsApp('nome_do_arquivo_final'), line('nome_do_arquivo_final'));
  assert.equal(formatWhatsApp('*sem fim'), line('*sem fim'));
});

test('pontuação conta como borda', () => {
  assert.equal(formatWhatsApp('(*oi*)!'), line('(<strong>oi</strong>)!'));
});

test('formatação aninhada', () => {
  assert.equal(formatWhatsApp('*_oi_*'), line('<strong><em>oi</em></strong>'));
});

test('não atravessa quebra de linha', () => {
  assert.equal(formatWhatsApp('*um\ndois*'), line('*um') + line('dois*'));
});

test('código na linha e bloco não recebem formatação por dentro', () => {
  assert.equal(formatWhatsApp('`*a*`'), line('<code>*a*</code>'));
  assert.equal(formatWhatsApp('```*a*\n_b_```'), line('<pre>*a*\n_b_</pre>'));
});

test('dígitos do texto não se confundem com os trechos guardados', () => {
  assert.equal(formatWhatsApp('`x` 0 1 2'), line('<code>x</code> 0 1 2'));
});

test('listas e citação', () => {
  assert.equal(formatWhatsApp('- item'), bullet('•', 'item'));
  assert.equal(formatWhatsApp('* item'), bullet('•', 'item'));
  assert.equal(formatWhatsApp('2. item'), bullet('2.', 'item'));
  assert.equal(formatWhatsApp('> citação'), '<div class="wa-quote">citação</div>');
});

test('linha vazia vira quebra', () => {
  assert.equal(formatWhatsApp('a\n\nb'), line('a') + line('<br>') + line('b'));
});

test('HTML no texto é sempre escapado, mesmo dentro da formatação', () => {
  const html = formatWhatsApp('<script>alert(1)</script> *"><img src=x onerror=alert(1)>*');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
});

test('negrito envolve a seleção e deixa os espaços das bordas de fora', () => {
  assert.deepEqual(toggleInline('um dois três', 2, 8, '*'), { text: 'um *dois* três', start: 4, end: 8 });
});

test('sem seleção, insere o par com o cursor no meio', () => {
  assert.deepEqual(toggleInline('oi ', 3, 3, '_'), { text: 'oi __', start: 4, end: 4 });
});

test('selecionar o texto já formatado tira a formatação', () => {
  assert.deepEqual(toggleInline('um *dois* três', 3, 9, '*'), { text: 'um dois três', start: 3, end: 7 });
  assert.deepEqual(toggleInline('um *dois* três', 4, 8, '*'), { text: 'um dois três', start: 3, end: 7 });
});

test('monoespaçado: uma linha vira código, várias viram bloco', () => {
  assert.deepEqual(toggleMonospace('a b', 2, 3), { text: 'a `b`', start: 3, end: 4 });
  assert.deepEqual(toggleMonospace('x\ny', 0, 3), { text: '```x\ny```', start: 3, end: 6 });
});

test('lista, lista numerada e citação nas linhas selecionadas', () => {
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 3, 'bullet'), { text: '- a\n- b', start: 0, end: 7 });
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 3, 'numbered'), { text: '1. a\n2. b', start: 0, end: 9 });
  assert.deepEqual(toggleLinePrefix('a', 1, 1, 'quote'), { text: '> a', start: 3, end: 3 });
});

test('se todas as linhas já têm o prefixo, tira', () => {
  assert.deepEqual(toggleLinePrefix('- a\n- b', 0, 7, 'bullet'), { text: 'a\nb', start: 0, end: 3 });
});

test('seleção que termina no começo da linha seguinte não a inclui', () => {
  assert.deepEqual(toggleLinePrefix('a\nb', 0, 2, 'bullet'), { text: '- a\nb', start: 0, end: 3 });
});

test('prefixo na primeira linha, mesmo com o texto começando por quebra', () => {
  assert.deepEqual(toggleLinePrefix('\na', 0, 0, 'bullet'), { text: '- \na', start: 2, end: 2 });
});

test('emoji entra no lugar da seleção, com o cursor depois dele', () => {
  assert.deepEqual(insertText('oi mundo', 3, 8, '📚'), { text: 'oi 📚', start: 5, end: 5 });
});
