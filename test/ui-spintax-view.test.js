// Spintax na tela: a prévia mostra a primeira variação e o editor conta as combinações.
import test from 'node:test';
import assert from 'node:assert/strict';
import { messageEditor, bubbleContent, messageList } from '../public/messages-view.js';

test('a prévia do balão mostra a primeira variação, formatada', () => {
  const html = bubbleContent({ text: '*{Ofertas|Promoções}* {de hoje|do dia}' });
  assert.match(html, /<strong>Ofertas<\/strong> de hoje/);
  assert.doesNotMatch(html, /[{}|]/, 'nenhuma chave ou barra sobra na prévia');
});

test('o editor mostra quantas combinações há, e esconde o aviso sem spintax', () => {
  const withSpintax = messageEditor({ nameField: 'name', textField: 'text', text: '{Bom dia|Olá} {grupo|pessoal}' });
  assert.match(withSpintax, /<p class="hint variants" data-role="variants" >4 combinações · a prévia mostra a primeira<\/p>/);
  const plain = messageEditor({ nameField: 'name', textField: 'text', text: 'Bom dia' });
  assert.match(plain, /data-role="variants" hidden><\/p>/);
});

test('a lista de mensagens também mostra a primeira variação no resumo', () => {
  const html = messageList({ messages: [{ id: 'm', name: 'x', text: '{Oi|Olá} grupo' }], schedules: [] });
  assert.match(html, /Oi grupo/);
  assert.doesNotMatch(html, /\{Oi\|Olá\}/);
});
