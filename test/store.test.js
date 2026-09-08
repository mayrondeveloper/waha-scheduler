import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStore, updateStore } from '../src/ui/store.js';

function newStorePath() {
  const dir = mkdtempSync(join(tmpdir(), 'waha-store-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({ version: 2, defaultGroups: [], messages: [], schedules: [] }));
  return path;
}

test('readStore devolve o store normalizado', () => {
  const path = newStorePath();
  const store = readStore(path);
  assert.equal(store.version, 2);
  assert.deepEqual(store.messages, []);
});

test('updateStore grava a mutação e devolve o resultado', async () => {
  const path = newStorePath();
  const saved = await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  assert.equal(saved.messages.length, 1);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).messages[0].text, 'Olá!');
});

test('updateStore recusa mutação inválida sem tocar no arquivo', async () => {
  const path = newStorePath();
  const antes = readFileSync(path, 'utf8');

  await assert.rejects(
    () => updateStore(path, (store) => {
      store.schedules.push({ name: 'x', cron: 'inválido', messageId: 'msg-a' });
      return store;
    }),
    /cron inválida/
  );

  assert.equal(readFileSync(path, 'utf8'), antes, 'arquivo não pode mudar em erro de validação');
});

test('não deixa arquivo temporário para trás', async () => {
  const path = newStorePath();
  await updateStore(path, (store) => {
    store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
    return store;
  });

  const restos = readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(restos, [], 'nenhum .tmp pode sobrar');
});

test('escritas concorrentes são serializadas, sem perder nenhuma', async () => {
  const path = newStorePath();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateStore(path, async (store) => {
        // O mutator PRECISA ser assíncrono e ceder o controle (await) entre ler
        // e alterar o store. Se toda a seção crítica de updateStore fosse
        // síncrona, o event loop já serializaria as chamadas sozinho e este
        // teste passaria mesmo com a fila (`queue`) removida — provando nada
        // sobre a fila. Não "simplifique" isso tirando o await.
        await new Promise((resolve) => setTimeout(resolve, 5));
        store.messages.push({ id: `msg-${i}`, name: `M${i}`, text: `texto ${i}` });
        return store;
      })
    )
  );

  const final = readStore(path);
  assert.equal(final.messages.length, 10, 'nenhuma escrita pode ser perdida');
});

test('readStore lança erro em português com o caminho quando o arquivo não existe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-store-'));
  const path = join(dir, 'nao-existe.json');

  assert.throws(
    () => readStore(path),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Não foi possível ler/);
      assert.ok(err.message.includes(path), 'mensagem deve conter o caminho do arquivo');
      return true;
    }
  );
});

test('readStore lança erro em português com o caminho quando o JSON é malformado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-store-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, '{ isso não é json válido');

  assert.throws(
    () => readStore(path),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /JSON inválido/);
      assert.ok(err.message.includes(path), 'mensagem deve conter o caminho do arquivo');
      return true;
    }
  );
});

test('não deixa arquivo .tmp para trás quando a gravação falha', async () => {
  const path = newStorePath();

  await assert.rejects(() =>
    updateStore(path, (store) => {
      // Simula uma falha durante a gravação (ex.: destino tomado por outro
      // processo entre a leitura e o rename): troca o arquivo final por um
      // diretório, o que faz o renameSync final falhar com EISDIR.
      unlinkSync(path);
      mkdirSync(path);
      store.messages.push({ id: 'msg-x', name: 'X', text: 'x' });
      return store;
    })
  );

  const restos = readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(restos, [], 'nenhum .tmp pode sobrar, mesmo quando o rename falha');
});

test('uma escrita que falha não trava a fila: as válidas seguem sendo gravadas', async () => {
  const path = newStorePath();

  const results = await Promise.allSettled([
    updateStore(path, (store) => {
      store.messages.push({ id: 'msg-ok-1', name: 'OK1', text: 'ok um' });
      return store;
    }),
    updateStore(path, (store) => {
      store.schedules.push({ name: 'falha', cron: 'inválido', messageId: 'msg-ok-1' });
      return store;
    }),
    updateStore(path, (store) => {
      store.messages.push({ id: 'msg-ok-2', name: 'OK2', text: 'ok dois' });
      return store;
    }),
    updateStore(path, (store) => {
      store.messages.push({ id: 'msg-ok-3', name: 'OK3', text: 'ok três' });
      return store;
    }),
  ]);

  assert.equal(results[0].status, 'fulfilled', 'primeira escrita (válida) deveria ter sido gravada');
  assert.equal(results[1].status, 'rejected', 'segunda escrita (cron inválida) deveria ter rejeitado');
  assert.match(results[1].reason.message, /cron inválida/);
  assert.equal(results[2].status, 'fulfilled', 'terceira escrita (válida) deveria ter sido gravada');
  assert.equal(results[3].status, 'fulfilled', 'quarta escrita (válida) deveria ter sido gravada');

  const final = readStore(path);
  assert.equal(final.messages.length, 3, 'as três escritas válidas devem estar presentes, e só elas');
});

test('updateStore avisa quando o mutator não devolve o store', async () => {
  const path = newStorePath();

  await assert.rejects(
    () =>
      updateStore(path, (store) => {
        // Muta in-place e "esquece" o return — erro comum de handler.
        store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
      }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mutator/i);
      assert.match(err.message, /não devolveu o store/);
      return true;
    }
  );

  // Como a mutação nunca foi validada nem gravada, o arquivo não deve mudar.
  const final = readStore(path);
  assert.equal(final.messages.length, 0, 'arquivo não pode mudar quando o mutator não devolve nada');
});

// A escrita atômica é obrigatória pelo spec: o scheduler lê o mesmo arquivo a
// qualquer momento e nunca pode pegá-lo pela metade. Os testes que citam
// ".tmp" acima só afirmam que nenhum sobrou — o que é trivialmente verdade se
// nenhum for criado: trocar `writeFileSync(tmp) + renameSync` por
// `writeFileSync(path)` direto passava por todos eles. Este teste não passa:
// ele observa a única coisa que distingue os dois caminhos de fora.

test('a gravação é atômica: substitui o arquivo por rename, nunca reescreve por cima', async () => {
  const path = newStorePath();
  const conteudoAntes = readFileSync(path, 'utf8');
  const inodeAntes = statSync(path).ino;

  // Um leitor concorrente (o scheduler recarregando) pode estar com o arquivo
  // já aberto quando a tela grava. Com .tmp + rename, esse descritor continua
  // preso ao inode antigo e lê a versão anterior INTEIRA; com writeFileSync
  // por cima do arquivo final, ele passa a enxergar o conteúdo novo — e, num
  // arquivo maior que um bloco, leria metade de cada versão.
  const fd = openSync(path, 'r');
  try {
    await updateStore(path, (store) => {
      store.messages.push({ id: 'msg-a', name: 'Oi', text: 'Olá!' });
      return store;
    });

    assert.equal(
      readFileSync(fd, 'utf8'),
      conteudoAntes,
      'quem abriu o arquivo antes da gravação tem que continuar lendo a versão anterior inteira'
    );
  } finally {
    closeSync(fd);
  }

  assert.notEqual(
    statSync(path).ino,
    inodeAntes,
    'o arquivo precisa ser SUBSTITUÍDO (inode novo, vindo do rename), não reescrito no lugar'
  );
  assert.equal(readStore(path).messages.length, 1, 'e a versão nova tem que estar no arquivo');
});
