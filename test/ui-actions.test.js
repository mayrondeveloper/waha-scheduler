import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockWaha } from '../harness/mock-waha.js';
import { startUi } from '../src/ui/server.js';
import { getTasks } from 'node-cron';

const PORT = 3995;

// Servidor exige Content-Type: application/json em toda rota mutante,
// incluindo POST /run, que não tem corpo — o cabeçalho continua obrigatório.
const run = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' } });

// A fixture precisa ter DUAS mensagens com textos distintos e DOIS agendamentos
// apontando para mensagens e grupos diferentes entre si — e "defaultGroups"
// diferente dos grupos de ambos. Só assim uma implementação errada que usasse
// sempre a primeira mensagem (store.messages[0]) ou sempre os grupos default
// (store.defaultGroups) fica reprovada por um teste que dispara o segundo
// agendamento (ver "disparar o segundo agendamento..." abaixo).
const FIRST_GROUP = '111111111111111111@g.us';
const SECOND_GROUP = '222222222222222222@g.us';
const DEFAULT_GROUP = '333333333333333333@g.us';

function newStore(dir) {
  const path = join(dir, 'schedules.json');
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: [DEFAULT_GROUP],
    messages: [
      { id: 'msg-a', name: 'Primeira', text: 'Mensagem do primeiro agendamento!' },
      { id: 'msg-b', name: 'Segunda', text: 'Mensagem do segundo agendamento!' },
    ],
    schedules: [
      { id: 'sch-a', name: 'primeiro', cron: '0 9 * * 1', messageId: 'msg-a',
        groups: [FIRST_GROUP] },
      { id: 'sch-b', name: 'segundo', cron: '0 10 * * 2', messageId: 'msg-b',
        groups: [SECOND_GROUP] },
    ],
  }));
  return path;
}

async function boot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waha-act-'));
  const { server: mock, calls } = await startMockWaha(PORT);
  t.after(() => mock.close());

  const cfg = {
    uiPort: 0,
    wahaUrl: `http://localhost:${PORT}`, session: 'default', apiKey: '',
    delayMinMs: 0, delayMaxMs: 0, logPath: join(dir, 'sends.jsonl'),
  };
  const { server, port } = await startUi({ schedulesPath: newStore(dir), cfg });
  t.after(() => server.close());

  return { call: (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init), calls, cfg, dir };
}

test('lista grupos do WAHA já normalizados', async (t) => {
  const { call } = await boot(t);
  const grupos = await (await call('/api/groups')).json();

  assert.equal(grupos.length, 3);
  assert.equal(grupos[0].id, '111111111111111111@g.us');
  assert.equal(grupos[0].name, 'Grupo Alpha');
});

test('WAHA fora do ar responde 502 sem derrubar o servidor', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-off-'));
  const cfg = { uiPort: 0, wahaUrl: 'http://localhost:3994',
                session: 'default', apiKey: '', logPath: join(dir, 'l.jsonl') };
  const { server, port } = await startUi({ schedulesPath: newStore(dir), cfg });
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${port}/api/groups`);
  assert.equal(res.status, 502);

  const ok = await fetch(`http://127.0.0.1:${port}/api/schedules`);
  assert.equal(ok.status, 200, 'o servidor tem que continuar de pé');
});

test('disparar agora envia pelo mock e devolve o resumo', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-a/run', run());
  assert.equal(res.status, 200);

  const resumo = await res.json();
  assert.equal(resumo.sent, 1);
  assert.equal(resumo.failed, 0);
  assert.equal(calls.length, 1, 'exatamente um envio pelo mock');
  assert.equal(calls[0].text, 'Mensagem do primeiro agendamento!');
  assert.equal(calls[0].chatId, FIRST_GROUP);
});

// Prova de detecção (ver relatório da Task 8): com uma única mensagem e
// defaultGroups igual aos groups do único agendamento, os 7 testes originais
// passariam mesmo com uma implementação que sempre usasse store.messages[0]
// ou sempre store.defaultGroups. Este teste dispara o SEGUNDO agendamento e
// confere que a mensagem e os destinos são os DELE — não os do primeiro
// agendamento, nem o texto que estaria em messages[0], nem defaultGroups.
test('disparar o segundo agendamento envia a mensagem e os grupos certos, não os do primeiro nem o default', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-b/run', run());
  assert.equal(res.status, 200);

  const resumo = await res.json();
  assert.equal(resumo.sent, 1);
  assert.equal(resumo.failed, 0);
  assert.equal(calls.length, 1, 'exatamente um envio pelo mock');

  assert.equal(calls[0].text, 'Mensagem do segundo agendamento!',
    'tem que ser o texto da mensagem do SEGUNDO agendamento, não a primeira mensagem da lista');
  assert.equal(calls[0].chatId, SECOND_GROUP,
    'tem que ir para o grupo do SEGUNDO agendamento, não para defaultGroups');

  assert.ok(!calls.some((c) => c.chatId === FIRST_GROUP),
    'nenhuma chamada pode ter ido para o grupo do primeiro agendamento');
  assert.ok(!calls.some((c) => c.chatId === DEFAULT_GROUP),
    'nenhuma chamada pode ter ido para defaultGroups');
});

test('disparar agendamento inexistente responde 404 sem enviar nada', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/schedules/sch-fantasma/run', run());
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test('histórico devolve as linhas do log, mais recentes primeiro', async (t) => {
  const { call } = await boot(t);
  await call('/api/schedules/sch-a/run', run());

  const logs = await (await call('/api/logs?limit=10')).json();
  assert.ok(logs.length >= 1);
  assert.equal(logs[0].status, 'sent');
  assert.equal(logs[0].chatId, '111111111111111111@g.us');
});

test('histórico inexistente devolve lista vazia, não erro', async (t) => {
  const { call } = await boot(t);
  const res = await call('/api/logs');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('linha corrompida no meio do log não derruba a leitura', async (t) => {
  const { call, cfg } = await boot(t);

  // Duas linhas válidas ao redor de uma corrompida — a leitura tem que
  // ignorar só a linha ruim, sem quebrar nem devolver erro.
  appendFileSync(cfg.logPath, `${JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', status: 'sent', chatId: 'a@g.us', message: 'primeira' })}\n`);
  appendFileSync(cfg.logPath, '{ isso não é json válido\n');
  appendFileSync(cfg.logPath, `${JSON.stringify({ ts: '2026-01-01T00:00:01.000Z', status: 'sent', chatId: 'b@g.us', message: 'terceira' })}\n`);

  const res = await call('/api/logs?limit=10');
  assert.equal(res.status, 200);

  const logs = await res.json();
  assert.equal(logs.length, 2, 'a linha corrompida deve ser descartada, não derrubar a leitura');
  assert.equal(logs[0].chatId, 'b@g.us', 'mais recente primeiro');
  assert.equal(logs[1].chatId, 'a@g.us');
});

test('GET /api/logs sanitiza limit inválido: cai no default de 100, não devolve o log inteiro', async (t) => {
  const { call, cfg } = await boot(t);

  // 150 linhas: mais que o default (100), para que "caiu no default" seja
  // observável — se a sanitização falhasse e devolvesse tudo, o teste veria 150.
  const total = 150;
  const lines = Array.from({ length: total }, (_, i) =>
    JSON.stringify({
      ts: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z`,
      status: 'sent',
      chatId: 'a@g.us',
      message: `linha ${i}`,
    })
  ).join('\n');
  writeFileSync(cfg.logPath, `${lines}\n`);

  for (const limit of ['-1', 'abc', '0', '']) {
    const res = await call(`/api/logs?limit=${limit}`);
    assert.equal(res.status, 200, `limit=${JSON.stringify(limit)}`);

    const logs = await res.json();
    assert.equal(logs.length, 100,
      `limit=${JSON.stringify(limit)} deveria cair no default de 100, e não devolver as ${total} linhas do log`);
  }
});

test('GET /api/logs?limit=1e9 é capado no teto de 1000, não devolve o log inteiro', async (t) => {
  const { call, cfg } = await boot(t);

  // 1200 linhas: mais que o teto (1000), para que o cap seja observável — se
  // não houvesse teto, o teste veria 1200 em vez de 1000.
  const total = 1200;
  const lines = Array.from({ length: total }, (_, i) =>
    JSON.stringify({
      ts: '2026-01-01T00:00:00.000Z',
      status: 'sent',
      chatId: 'a@g.us',
      message: `linha ${i}`,
    })
  ).join('\n');
  writeFileSync(cfg.logPath, `${lines}\n`);

  const res = await call('/api/logs?limit=1e9');
  assert.equal(res.status, 200);

  const logs = await res.json();
  assert.equal(logs.length, 1000,
    `limit=1e9 deveria ser capado em 1000, e não devolver as ${total} linhas do log`);
});

test('preview de cron devolve os próximos disparos', async (t) => {
  const { call } = await boot(t);

  const ok = await (await call('/api/cron/preview?expr=' + encodeURIComponent('0 9 * * 1'))).json();
  assert.equal(ok.valid, true);
  assert.equal(ok.next.length, 3);
  assert.ok(new Date(ok.next[0]) > new Date(), 'o primeiro disparo tem que ser no futuro');

  const ruim = await (await call('/api/cron/preview?expr=' + encodeURIComponent('não-é-cron'))).json();
  assert.equal(ruim.valid, false);
  assert.deepEqual(ruim.next, []);
});

// A rota cria a task só para consultar getNextRuns() e promete destruí-la
// em seguida (comentário em src/ui/routes/actions.js), mas isso nunca tinha
// teste — nem para o caminho feliz, nem para quando o cálculo dos próximos
// disparos lança. "0 0 31W 2 *" (dia útil mais próximo do dia 31 de
// fevereiro) passa por validate() — a checagem estática de node-cron não
// cobre o token "W" — mas nunca corresponde a nenhuma data real; node-cron
// procura por 100 anos e desiste lançando. Isso derruba a rota (500, sem
// passar em silêncio — consistente com a regra do projeto), mas a garantia
// que importa aqui é: node-cron não pode ficar com essa task presa no
// registro global (getTasks()) depois da falha.
test('preview com cron que nunca casa com nenhuma data não deixa task pendurada no registro do node-cron', async (t) => {
  const { call } = await boot(t);
  const antes = getTasks().size;

  const res = await call('/api/cron/preview?expr=' + encodeURIComponent('0 0 31W 2 *'));
  assert.equal(res.status, 500, 'não há como calcular os próximos disparos: tem que reportar erro, não 200 silencioso');

  assert.equal(getTasks().size, antes, 'nenhuma task pode continuar registrada após a falha');
});

// A task criada pela rota só serve para consultar getNextRuns() — o
// callback passado a ela é um no-op e nunca chama broadcast/sendText. Prova
// disso: um cron que casa com "agora mesmo" (todo segundo) não gera NENHUMA
// chamada ao mock do WAHA, mesmo esperando além do próximo tick — a task é
// destruída antes de ter chance de disparar de verdade.
test('preview nunca dispara envio de verdade, mesmo com um cron que casa imediatamente', async (t) => {
  const { call, calls } = await boot(t);

  const res = await call('/api/cron/preview?expr=' + encodeURIComponent('* * * * * *'));
  assert.equal(res.status, 200);
  const corpo = await res.json();
  assert.equal(corpo.valid, true);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(calls.length, 0, 'o preview não pode ter disparado nenhum envio de verdade pelo mock');
});
