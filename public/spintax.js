// Spintax: "{Bom dia|Olá|Oi}, grupo!" vira uma combinação sorteada por grupo,
// para a mesma mensagem não sair idêntica em todos. Aninhamento vale
// ("{Bom {dia|tarde}|Olá}"); chave sem par e "|" fora de chaves são texto.
// Sem DOM: o servidor importa este módulo também.

// Árvore do texto: uma sequência de trechos literais e grupos; cada grupo é
// uma lista de alternativas, e cada alternativa é outra sequência.
function parse(text) {
  const source = String(text ?? '');
  const open = [];
  const match = new Map();
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') open.push(i);
    else if (source[i] === '}' && open.length > 0) match.set(open.pop(), i);
  }

  const sequence = (start, end) => {
    const nodes = [];
    let literal = '';
    for (let i = start; i < end; i++) {
      const c = source[i];
      if (c === '{' && match.has(i)) {
        if (literal) nodes.push(literal);
        literal = '';
        const close = match.get(i);
        nodes.push({ alternatives: alternatives(i + 1, close) });
        i = close;
      } else {
        literal += c;
      }
    }
    if (literal) nodes.push(literal);
    return nodes;
  };

  const alternatives = (start, end) => {
    const result = [];
    let from = start;
    for (let i = start; i < end; i++) {
      if (source[i] === '{' && match.has(i)) {
        i = match.get(i);
      } else if (source[i] === '|') {
        result.push(sequence(from, i));
        from = i + 1;
      }
    }
    result.push(sequence(from, end));
    return result;
  };

  return sequence(0, source.length);
}

function render(nodes, choose) {
  return nodes.map((node) => (typeof node === 'string' ? node : render(choose(node.alternatives), choose))).join('');
}

function count(nodes) {
  return nodes.reduce((total, node) => {
    if (typeof node === 'string') return total;
    return total * node.alternatives.reduce((sum, alt) => sum + count(alt), 0);
  }, 1);
}

/**
 * Uma combinação sorteada do texto.
 * @param {string} text
 * @param {() => number} [random] Gerador em [0, 1), injetável nos testes.
 * @returns {string}
 */
export function spin(text, random = Math.random) {
  return render(parse(text), (alts) => alts[Math.min(alts.length - 1, Math.floor(random() * alts.length))]);
}

/**
 * A primeira alternativa de cada grupo: o que a prévia mostra.
 * @param {string} text
 * @returns {string}
 */
export function firstVariant(text) {
  return render(parse(text), (alts) => alts[0]);
}

/**
 * Quantas combinações diferentes o texto produz (1 sem spintax).
 * @param {string} text
 * @returns {number}
 */
export function countVariants(text) {
  return count(parse(text));
}

/**
 * Texto do aviso de variações no editor: "8 combinações · a prévia mostra a
 * primeira", ou '' quando não há spintax.
 * @param {string} text
 * @returns {string}
 */
export function variantsHint(text) {
  const n = countVariants(text);
  return n > 1 ? `${n} combinações · a prévia mostra a primeira` : '';
}
