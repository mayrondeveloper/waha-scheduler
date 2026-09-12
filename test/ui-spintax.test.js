import test from 'node:test';
import assert from 'node:assert/strict';
import { spin, firstVariant, countVariants, variantsHint } from '../public/spintax.js';

// random fixo: escolhe sempre a alternativa de índice i.
const pick = (i) => () => i / 100;

test('texto sem chaves passa como está', () => {
  assert.equal(spin('Bom dia, grupo!'), 'Bom dia, grupo!');
  assert.equal(countVariants('Bom dia, grupo!'), 1);
  assert.equal(variantsHint('Bom dia'), '');
  assert.equal(spin(''), '');
  assert.equal(spin(null), '');
});

test('um grupo sorteia uma alternativa; a primeira é a da prévia', () => {
  assert.equal(spin('{Bom dia|Olá|Oi}, grupo!', pick(0)), 'Bom dia, grupo!');
  assert.equal(spin('{Bom dia|Olá|Oi}, grupo!', pick(99)), 'Oi, grupo!');
  assert.equal(spin('{Bom dia|Olá|Oi}, grupo!', () => 0.5), 'Olá, grupo!');
  assert.equal(firstVariant('{Bom dia|Olá|Oi}, grupo!'), 'Bom dia, grupo!');
  assert.equal(countVariants('{Bom dia|Olá|Oi}, grupo!'), 3);
});

test('vários grupos multiplicam; aninhado soma dentro da alternativa', () => {
  assert.equal(countVariants('{a|b} {c|d|e}'), 6);
  assert.equal(countVariants('{Bom {dia|tarde}|Olá}'), 3);
  assert.equal(spin('{Bom {dia|tarde}|Olá}', pick(0)), 'Bom dia');
  assert.equal(spin('{Bom {dia|tarde}|Olá}', pick(99)), 'Olá');
  assert.equal(firstVariant('{Bom {dia|tarde}|Olá}!'), 'Bom dia!');
  assert.equal(variantsHint('{a|b} {c|d|e}'), '6 combinações · a prévia mostra a primeira');
});

test('chave sem par, "|" solto e chave sem alternativa são texto', () => {
  assert.equal(spin('preço {sem fechar'), 'preço {sem fechar');
  assert.equal(spin('a | b'), 'a | b');
  assert.equal(spin('} solta {x|y}', pick(0)), '} solta x');
  assert.equal(spin('{só um}'), 'só um');
  assert.equal(countVariants('{só um} {x|y'), 1);
});

test('formatação do WhatsApp e quebras de linha sobrevivem ao sorteio', () => {
  const text = '*Ofertas* {de hoje|do dia}\n\n- Item\n> {Válido até domingo|Só hoje}';
  assert.equal(spin(text, pick(99)), '*Ofertas* do dia\n\n- Item\n> Só hoje');
});
