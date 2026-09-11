// Formatação do WhatsApp: a prévia formatada e as ações da barra do editor.
// O texto guardado e enviado é sempre o cru, com os marcadores; só a prévia
// os interpreta. Sem DOM: importável pelos testes.

import { escape } from './html.js';

// Negrito, itálico e tachado só valem colados na palavra, como no WhatsApp:
// o marcador de abertura vem no início ou depois de algo que não é letra,
// número ou "_", seguido de caractere que não é espaço; o de fechamento vem
// depois de caractere que não é espaço, antes do fim ou de algo que não é
// letra ou número. Assim "2*3*4", "* texto *" e "nome_do_arquivo" ficam como
// estão. Nenhum atravessa quebra de linha.
const BOLD = /(^|[^\p{L}\p{N}_*])\*(?=\S)([^\n]*?\S)\*(?=$|[^\p{L}\p{N}_*])/gu;
const ITALIC = /(^|[^\p{L}\p{N}_])_(?=\S)([^\n]*?\S)_(?=$|[^\p{L}\p{N}_])/gu;
const STRIKE = /(^|[^\p{L}\p{N}_~])~(?=\S)([^\n]*?\S)~(?=$|[^\p{L}\p{N}_~])/gu;

const LINE_PREFIX = { bullet: /^[-*] /, numbered: /^\d+\. /, quote: /^> / };

function inline(html) {
  return html
    .replace(BOLD, '$1<strong>$2</strong>')
    .replace(ITALIC, '$1<em>$2</em>')
    .replace(STRIKE, '$1<s>$2</s>');
}

/**
 * Texto cru -> HTML da prévia, com as regras de formatação do WhatsApp.
 * O texto é escapado ANTES de qualquer formatação: nada que o usuário
 * digita vira HTML.
 * @param {string} text
 * @returns {string}
 */
export function formatWhatsApp(text) {
  // Marcadores de uso privado do Unicode guardam o lugar de cada trecho
  // separado; o texto do usuário não os produz na prática.
  const slots = [];
  const keep = (html) => `\uE000${slots.push(html) - 1}\uE001`;

  let html = escape(String(text ?? '').replace(/\r\n?/g, '\n'));

  // Blocos e código na linha saem primeiro e voltam no fim: o que está
  // dentro deles não recebe nenhuma outra formatação.
  html = html.replace(/```([\s\S]+?)```/g, (_, code) => keep(`<pre>${code}</pre>`));
  html = html.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));

  const lines = html.split('\n').map((line) => {
    let match;
    if ((match = /^&gt; (.*)$/.exec(line))) {
      return `<div class="wa-quote">${inline(match[1]) || '<br>'}</div>`;
    }
    if ((match = /^[-*] (.*)$/.exec(line))) {
      return `<div class="wa-li"><span class="wa-mark">•</span><span>${inline(match[1])}</span></div>`;
    }
    if ((match = /^(\d+)\. (.*)$/.exec(line))) {
      return `<div class="wa-li"><span class="wa-mark">${match[1]}.</span><span>${inline(match[2])}</span></div>`;
    }
    return `<div class="wa-line">${line ? inline(line) : '<br>'}</div>`;
  });

  return lines.join('').replace(/\uE000(\d+)\uE001/g, (_, index) => slots[Number(index)]);
}

/**
 * Liga ou desliga um marcador (negrito "*", itálico "_", tachado "~", código
 * "`" ou bloco "```") na seleção. Espaços nas bordas ficam fora dos
 * marcadores, porque o WhatsApp não formata "* texto *". Sem seleção,
 * insere o par com o cursor no meio.
 * @param {string} text Texto do campo.
 * @param {number} start Início da seleção.
 * @param {number} end Fim da seleção.
 * @param {string} marker
 * @returns {{text: string, start: number, end: number}} Texto e seleção novos.
 */
export function toggleInline(text, start, end, marker) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;

  const size = marker.length;
  if (from === to) {
    const at = from + size;
    return { text: text.slice(0, from) + marker + marker + text.slice(to), start: at, end: at };
  }

  const selected = text.slice(from, to);
  // Já formatado, com os marcadores dentro da seleção: tira.
  if (selected.length > size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(size, -size);
    return { text: text.slice(0, from) + inner + text.slice(to), start: from, end: from + inner.length };
  }
  // Já formatado, com os marcadores logo fora da seleção: tira.
  if (from >= size && text.slice(from - size, from) === marker && text.slice(to, to + size) === marker) {
    return {
      text: text.slice(0, from - size) + selected + text.slice(to + size),
      start: from - size,
      end: to - size,
    };
  }
  return {
    text: text.slice(0, from) + marker + selected + marker + text.slice(to),
    start: from + size,
    end: to + size,
  };
}

/**
 * Monoespaçado: seleção de uma linha vira código na linha (`texto`); de
 * várias linhas vira bloco (```texto```). Já formatada, desfaz.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{text: string, start: number, end: number}}
 */
export function toggleMonospace(text, start, end) {
  const multiline = text.slice(start, end).includes('\n');
  return toggleInline(text, start, end, multiline ? '```' : '`');
}

/**
 * Lista, lista numerada ou citação em cada linha tocada pela seleção. Se
 * todas as linhas com texto já têm o prefixo, tira.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {'bullet'|'numbered'|'quote'} kind
 * @returns {{text: string, start: number, end: number}}
 */
export function toggleLinePrefix(text, start, end, kind) {
  const pattern = LINE_PREFIX[kind];
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  // Seleção que termina logo depois de uma quebra não toca a linha seguinte.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const lineEnd = text.indexOf('\n', last);
  const to = lineEnd === -1 ? text.length : lineEnd;

  const lines = text.slice(from, to).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const removing = filled.length > 0 && filled.every((line) => pattern.test(line));

  let count = 0;
  const changed = lines.map((line) => {
    if (removing) return line.replace(pattern, '');
    if (line.trim() === '' && lines.length > 1) return line;
    count += 1;
    const prefix = kind === 'bullet' ? '- ' : kind === 'quote' ? '> ' : `${count}. `;
    return prefix + line.replace(pattern, '');
  });

  const block = changed.join('\n');
  const next = text.slice(0, from) + block + text.slice(to);
  return start === end
    ? { text: next, start: from + block.length, end: from + block.length }
    : { text: next, start: from, end: from + block.length };
}

/**
 * Insere um texto (um emoji, por exemplo) no lugar da seleção.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {string} value
 * @returns {{text: string, start: number, end: number}}
 */
export function insertText(text, start, end, value) {
  const at = start + value.length;
  return { text: text.slice(0, start) + value + text.slice(end), start: at, end: at };
}
