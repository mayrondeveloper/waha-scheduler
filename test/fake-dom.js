// Formulário e DOM de mentira para testar a tela sem navegador.

export const unescapeHtml = (value) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const attr = (source, name) => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(source);
  return found ? unescapeHtml(found[1]) : undefined;
};

// Form montado a partir do HTML que a tela gerou, com o que as funções de
// leitura do formulário consultam. É o elo que prova que o que o formulário
// desenha é exatamente o que vira payload do save.
export function fakeForm(html) {
  const fields = [];
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    fields.push({
      id: attr(tag, 'id'),
      name: attr(tag, 'name'),
      value: attr(tag, 'value') ?? '',
      checked: /\schecked\b/.test(tag),
    });
  }
  for (const [, attrs, body] of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    fields.push({ id: attr(attrs, 'id'), name: attr(attrs, 'name'), value: unescapeHtml(body) });
  }
  for (const [, attrs, body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const option = /<option value="([^"]*)" selected/.exec(body) ?? /<option value="([^"]*)"/.exec(body);
    fields.push({ id: attr(attrs, 'id'), name: attr(attrs, 'name'), value: option ? unescapeHtml(option[1]) : '' });
  }

  return {
    id: /<form\b[^>]*\sid="([^"]*)"/.exec(html)?.[1],
    getAttribute: () => null,
    querySelector(selector) {
      const byId = /^#(.+)$/.exec(selector);
      if (byId) return fields.find((f) => f.id === byId[1]) ?? null;
      const byName = /^(?:input|textarea|select)?\[name="([^"]+)"\]$/.exec(selector);
      if (byName) return fields.find((f) => f.name === byName[1]) ?? null;
      if (selector === '[type="submit"]') return { disabled: false, isConnected: false };
      return null;
    },
    querySelectorAll(selector) {
      const checked = /^input\[name="([^"]+)"\]:checked$/.exec(selector);
      return checked ? fields.filter((f) => f.name === checked[1] && f.checked) : [];
    },
  };
}

// Elemento de mentira: guarda o que a tela escreve nele e devolve outro
// elemento de mentira para qualquer seletor, sempre o mesmo por seletor.
export function fakeElement() {
  const children = new Map();
  return {
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: false,
    open: false,
    disabled: false,
    returnValue: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    append() {},
    remove() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, fakeElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

// Instala um document e um fetch de mentira no globalThis e devolve um
// atalho para consultar os elementos que a tela usou.
export function installDom(fetch) {
  const elements = new Map();
  globalThis.document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => fakeElement(),
  };
  globalThis.fetch = fetch;
  return (selector) => globalThis.document.querySelector(selector);
}
