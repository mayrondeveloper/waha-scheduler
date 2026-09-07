import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
import { checkCron, loadSchedules, validateMessage, validateSchedule, normalizeStore } from '../src/schedules.js';
import { getTasks } from 'node-cron';

function writeSchedules(content) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-sched-'));
  const path = join(dir, 'schedules.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

test('carrega agendamentos válidos aplicando o default de enabled', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [
      { name: 'manha', cron: '0 9 * * 1', message: 'oi', groups: ['2@g.us'] },
      { name: 'tarde', cron: '0 15 * * *', message: 'boa tarde', groups: ['2@g.us'], enabled: false },
    ],
  });

  const { defaultGroups, schedules } = loadSchedules(path);
  assert.deepEqual(defaultGroups, ['1@g.us']);
  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].enabled, true, 'enabled deve assumir true quando ausente');
  assert.equal(schedules[1].enabled, false);
});

test('agendamento sem groups herda defaultGroups', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us', '2@g.us'],
    schedules: [{ name: 'herda', cron: '0 9 * * 1', message: 'oi' }],
  });

  assert.deepEqual(loadSchedules(path).schedules[0].groups, ['1@g.us', '2@g.us']);
});

test('cron inválido é recusado e o erro nomeia o agendamento', () => {
  const path = writeSchedules({
    schedules: [{ name: 'quebrado', cron: 'não-é-cron', message: 'x', groups: ['1@g.us'] }],
  });

  assert.throws(() => loadSchedules(path), /Agendamento "quebrado".*cron inválida/s);
});

test('campos obrigatórios ausentes são recusados', () => {
  const semMensagem = writeSchedules({
    schedules: [{ name: 'sem-msg', cron: '0 9 * * 1', groups: ['1@g.us'] }],
  });
  assert.throws(() => loadSchedules(semMensagem), /"messageId" é obrigatório/);

  const semCron = writeSchedules({ schedules: [{ name: 'sem-cron', message: 'x' }] });
  assert.throws(() => loadSchedules(semCron), /"cron" é obrigatório/);
});

test('agendamento sem nenhum grupo de destino é recusado', () => {
  const path = writeSchedules({
    schedules: [{ name: 'sem-grupo', cron: '0 9 * * 1', message: 'x' }],
  });
  assert.throws(() => loadSchedules(path), /nenhum grupo de destino/);
});

test('nomes duplicados são recusados', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [
      { name: 'igual', cron: '0 9 * * 1', message: 'a' },
      { name: 'igual', cron: '0 10 * * 1', message: 'b' },
    ],
  });
  assert.throws(() => loadSchedules(path), /nome duplicado/);
});

test('arquivo ausente e JSON inválido geram erro com contexto', () => {
  assert.throws(() => loadSchedules('/caminho/que/nao/existe.json'), /Não foi possível ler/);

  const quebrado = writeSchedules('{ isso não é json }');
  assert.throws(() => loadSchedules(quebrado), /JSON inválido/);
});

test('schedules.example.json do repositório é válido', () => {
  const { schedules } = loadSchedules(join(projectRoot, 'schedules.example.json'));
  assert.ok(Array.isArray(schedules));
});

test('validateMessage exige name e text, e gera id quando ausente', () => {
  const msg = validateMessage({ name: 'Bom dia', text: 'Olá!' });
  assert.match(msg.id, /^msg-/);
  assert.equal(msg.name, 'Bom dia');
  assert.equal(msg.text, 'Olá!');

  assert.throws(() => validateMessage({ text: 'sem nome' }), /"name" é obrigatório/);
  assert.throws(() => validateMessage({ name: 'sem texto' }), /"text" é obrigatório/);
});

test('validateSchedule recusa messageId inexistente', () => {
  assert.throws(
    () => validateSchedule(
      { name: 'x', cron: '0 9 * * 1', messageId: 'msg-nao-existe', groups: ['1@g.us'] },
      { defaultGroups: [], messageIds: new Set(['msg-existe']) }
    ),
    /mensagem "msg-nao-existe" não existe/
  );
});

test('normalizeStore converte o formato v1 para v2', () => {
  const v1 = {
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'antigo', cron: '0 9 * * 1', message: 'texto inline' }],
  };
  const store = normalizeStore(v1);

  assert.equal(store.version, 2);
  assert.equal(store.messages.length, 1);
  assert.equal(store.messages[0].text, 'texto inline');
  assert.equal(store.schedules[0].messageId, store.messages[0].id);
});

test('normalizeStore mantém v2 intacto e resolve o texto da mensagem', () => {
  const v2 = {
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'novo', cron: '0 9 * * 1', messageId: 'msg-a' }],
  };
  const store = normalizeStore(v2);

  assert.equal(store.messages.length, 1);
  assert.equal(store.schedules[0].messageId, 'msg-a');
  assert.deepEqual(store.schedules[0].groups, ['1@g.us']);
});

test('loadSchedules entrega o texto da mensagem resolvido em cada agendamento', () => {
  const path = writeSchedules({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'novo', cron: '0 9 * * 1', messageId: 'msg-a' }],
  });

  const { schedules, messages } = loadSchedules(path);
  assert.equal(messages.length, 1);
  assert.equal(schedules[0].message, 'Olá!');
});

// --- Correções de achados da revisão de qualidade da Task 2 ---

test('normalizeStore preserva o id do agendamento vindo de arquivo v2', () => {
  const v2 = {
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-a', name: 'novo', cron: '0 9 * * 1', messageId: 'msg-a' }],
  };
  const store = normalizeStore(v2);

  assert.equal(store.schedules[0].id, 'sch-a');
});

test('id de agendamento com tipo errado gera Error em português, não TypeError', () => {
  try {
    validateSchedule(
      { id: 123, name: 'x', cron: '0 9 * * 1', messageId: 'm', groups: ['1@g.us'] },
      { messageIds: new Set(['m']) }
    );
    assert.fail('deveria ter lançado erro');
  } catch (err) {
    assert.equal(err instanceof TypeError, false);
    assert.match(err.message, /campo "id" deve ser um texto/);
  }
});

test('ids de mensagem duplicados são recusados', () => {
  assert.throws(
    () =>
      normalizeStore({
        messages: [
          { id: 'msg-dup', name: 'a', text: 'texto a' },
          { id: 'msg-dup', name: 'b', text: 'texto b' },
        ],
        schedules: [],
      }),
    /"msg-dup".*duplicado/s
  );
});

test('agendamento v1 com "message" vazia é recusado como erro de agendamento, não de mensagem', () => {
  const path = writeSchedules({
    schedules: [{ name: 'sch1', cron: '0 9 * * 1', message: '', groups: ['1@g.us'] }],
  });
  assert.throws(() => loadSchedules(path), /Agendamento "sch1": campo "message" é obrigatório/);
});

test('agendamento v1 com "name" inválido é recusado como erro de agendamento, não de mensagem', () => {
  const path = writeSchedules({
    schedules: [{ name: 42, cron: '0 9 * * 1', message: 'oi', groups: ['1@g.us'] }],
  });
  assert.throws(() => loadSchedules(path), /Agendamento #1: campo "name" é obrigatório/);
});

test('loadSchedules de arquivo v1 devolve messages com a mensagem sintética', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'legado', cron: '0 9 * * 1', message: 'texto legado' }],
  });

  const { messages, schedules } = loadSchedules(path);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'texto legado');
  assert.equal(schedules[0].messageId, messages[0].id);
});

test('duas leituras do mesmo arquivo v1 devolvem os mesmos ids', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'estavel', cron: '0 9 * * 1', message: 'oi' }],
  });

  const first = loadSchedules(path);
  const second = loadSchedules(path);
  assert.equal(first.schedules[0].id, second.schedules[0].id);
  assert.equal(first.messages[0].id, second.messages[0].id);
});

test('dois agendamentos sem nome geram mensagens de erro distintas', () => {
  let firstError;
  let secondError;

  try {
    validateSchedule({ cron: '0 9 * * 1', messageId: 'm' }, { messageIds: new Set(['m']) }, 0);
  } catch (err) {
    firstError = err.message;
  }
  try {
    validateSchedule({ cron: '0 9 * * 1', messageId: 'm' }, { messageIds: new Set(['m']) }, 1);
  } catch (err) {
    secondError = err.message;
  }

  assert.match(firstError, /#1/);
  assert.match(secondError, /#2/);
  assert.notEqual(firstError, secondError);
});

// "groups" ausente e "groups: []" NÃO são a mesma coisa: com um seletor de
// grupos na tela, a lista vazia é uma escolha do usuário, e herdar os defaults
// nesse caso trocaria os destinatários em silêncio.
test('groups: [] explícito é recusado, em vez de herdar defaultGroups', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us', '2@g.us'],
    schedules: [{ name: 'grupos-vazios', cron: '0 9 * * 1', message: 'oi', groups: [] }],
  });

  assert.throws(() => loadSchedules(path), /lista de grupos vazia/);
});

test('groups informado só com entradas em branco é recusado', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'grupos-brancos', cron: '0 9 * * 1', message: 'oi', groups: ['', '  '] }],
  });

  assert.throws(() => loadSchedules(path), /nenhum grupo de destino|lista de grupos vazia/);
});

// A validação só chamava validate(), a checagem estática do node-cron.
// "0 0 31W 2 *" (dia útil mais próximo do dia 31 de fevereiro) passa nela mas
// nunca casa com data nenhuma: schedule() lança ao tentar registrá-la. A tela
// gravava, a recarga falhava só num log e o próximo `npm start` ABORTAVA,
// exigindo editar o JSON na mão — o oposto do que a ferramenta existe para
// fazer.

test('cron que passa em validate() mas o node-cron recusa registrar é rejeitado', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    schedules: [{ name: 'nunca-dispara', cron: '0 0 31W 2 *', message: 'oi' }],
  });

  assert.throws(
    () => loadSchedules(path),
    /Agendamento "nunca-dispara".*cron inválida.*não é registrável/s,
    'o erro precisa nomear o agendamento e dizer por que a expressão não serve'
  );
});

test('checkCron não deixa task pendurada no registro do node-cron', () => {
  const antes = getTasks().size;

  assert.equal(checkCron('0 9 * * 1').valid, true);
  assert.equal(checkCron('0 0 31W 2 *').valid, false);
  assert.equal(checkCron('não-é-cron').valid, false);

  assert.equal(getTasks().size, antes, 'validar não pode registrar task nenhuma');
});

test('checkCron com fuso inválido acusa o fuso, não a expressão', () => {
  // A expressão abaixo é válida. Se o erro falar de cron, o usuário vai
  // procurar o defeito no lugar errado.
  assert.throws(() => checkCron('0 9 * * 1', 'America/SaoPaulo'), /fuso|TIMEZONE/i);

  const semFuso = checkCron('0 9 * * 1', 'America/Sao_Paulo');
  assert.equal(semFuso.valid, true);
});

test('nome de mensagem duplicado é recusado na leitura, como já é na API', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    messages: [
      { id: 'msg-a', name: 'Bom dia', text: 'primeiro texto' },
      { id: 'msg-b', name: 'Bom dia', text: 'segundo texto' },
    ],
    schedules: [],
  });

  // Duas mensagens com o mesmo nome viram duas opções idênticas no seletor da
  // tela, e o usuário escolhe a errada sem ter como distinguir.
  assert.throws(() => loadSchedules(path), /Mensagem "Bom dia".*duplicado/s);
});

test('nomes de mensagem que só diferem por espaço em volta contam como duplicados', () => {
  const path = writeSchedules({
    defaultGroups: ['1@g.us'],
    messages: [
      { id: 'msg-a', name: 'Aviso', text: 'a' },
      { id: 'msg-b', name: '  Aviso  ', text: 'b' },
    ],
    schedules: [],
  });

  assert.throws(() => loadSchedules(path), /duplicado/);
});
