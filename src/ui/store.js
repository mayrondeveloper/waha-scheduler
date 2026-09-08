// Leitura e escrita atômica do arquivo de agendamentos, com escritas serializadas.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { normalizeStore } from '../schedules.js';

// Serializa as escritas: cada updateStore encadeia na anterior. Um processo,
// um escritor — não é lock entre processos, e o design não precisa de um.
let queue = Promise.resolve();

/**
 * Lê e valida o arquivo, devolvendo o store no formato v2.
 * @param {string} path Caminho do arquivo.
 * @returns {{version: 2, defaultGroups: string[], messages: object[], schedules: object[]}}
 */
export function readStore(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON inválido em ${path}: ${err.message}`);
  }

  return normalizeStore(parsed);
}

/**
 * Aplica uma mutação ao store e grava de forma atômica. Escritas concorrentes
 * são enfileiradas, então cada mutação enxerga o resultado da anterior.
 * @param {string} path Caminho do arquivo.
 * @param {(store: object) => (object | Promise<object>)} mutator Recebe o
 *   store e devolve o novo. Pode ser assíncrono — o `await` sobre o retorno é
 *   o ponto de cessão de controle dentro da seção crítica que torna a fila
 *   necessária: sem ele, tudo entre a leitura e a gravação seria síncrono e o
 *   event loop já serializaria as chamadas sozinho.
 * @returns {Promise<object>} O store gravado.
 */
export function updateStore(path, mutator) {
  const run = async () => {
    const current = readStore(path);
    const mutated = await mutator(current);

    if (mutated === undefined) {
      throw new Error(
        `updateStore(${path}): o mutator não devolveu o store atualizado (retornou undefined). ` +
          'Mutators que alteram o store in-place também precisam terminar com "return store".'
      );
    }

    // Revalida o resultado da mutação: a API não pode gravar algo que o
    // scheduler recusaria no boot.
    const validated = normalizeStore(mutated);

    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      // rename() é atômico no mesmo filesystem: o scheduler nunca lê um
      // arquivo pela metade.
      renameSync(tmp, path);
    } catch (err) {
      if (existsSync(tmp)) unlinkSync(tmp);
      throw new Error(`Não foi possível gravar ${path}: ${err.message}`);
    }

    return validated;
  };

  // Encadeia mesmo em caso de falha, para um erro não travar a fila.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
