import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTasks } from 'node-cron';
import { startScheduler, watchFile } from '../src/index.js';

// Espera tolerante o suficiente para o debounce de 200ms de watchFile (ver
// RELOAD_DEBOUNCE_MS em src/index.js) mais alguma folga para fs.watch em
// diferentes plataformas, sem deixar o teste demorado.
const WATCH_SETTLE_MS = 500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeConfig(path, cronDoSegundo) {
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'primeiro', cron: '0 9 * * 1', messageId: 'msg-a' },
      ...(cronDoSegundo
        ? [{ id: 'sch-b', name: 'segundo', cron: cronDoSegundo, messageId: 'msg-a' }]
        : []),
    ],
  }));
}

function newPath() {
  return join(mkdtempSync(join(tmpdir(), 'waha-reload-')), 'schedules.json');
}

test('reload aplica agendamento novo sem reiniciar', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['primeiro']);

  writeConfig(path, '0 10 * * 1');
  scheduler.reload();

  assert.deepEqual(scheduler.activeNames, ['primeiro', 'segundo']);
});

test('reload com config inválida preserva a anterior e não derruba', (t) => {
  const path = newPath();
  writeConfig(path, null);

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  writeFileSync(path, '{ isso não é json }');
  const ok = scheduler.reload();

  assert.equal(ok, false, 'reload deve reportar falha');
  assert.deepEqual(scheduler.activeNames, ['primeiro'], 'config anterior preservada');
});

test('agendamento desabilitado não entra nos ativos', (t) => {
  const path = newPath();
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [
      { id: 'sch-a', name: 'ligado', cron: '0 9 * * 1', messageId: 'msg-a' },
      { id: 'sch-b', name: 'desligado', cron: '0 9 * * 2', messageId: 'msg-a', enabled: false },
    ],
  }));

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  assert.deepEqual(scheduler.activeNames, ['ligado']);
});

// --- Achado 4: a propriedade mais crítica (task antiga realmente parada) ---
// getTasks() é o registro GLOBAL do node-cron (module-level, compartilhado
// por todo o processo). Isso é seguro aqui porque `node --test` isola cada
// arquivo de teste em seu próprio processo (test-isolation "process", que é
// o padrão) e os testes deste arquivo rodam em sequência, cada um limpando
// suas próprias tasks via t.after — então o registro só contém as tasks
// deste arquivo no momento em que cada teste roda.

test('reload destrói (não apenas para) a task de um agendamento removido', (t) => {
  const path = newPath();
  writeConfig(path, null); // só "primeiro"

  const scheduler = startScheduler({ schedulesPath: path });
  t.after(() => scheduler.stop());

  const before = [...getTasks().values()];
  assert.equal(before.length, 1, 'deveria haver exatamente uma task registrada para "primeiro"');
  const oldTask = before[0];
  assert.notEqual(oldTask.getStatus(), 'destroyed', 'a task recém-criada não deveria começar destruída');

  // Recarrega com uma config que NÃO tem mais "primeiro" — ele foi removido
  // pela tela.
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-c', name: 'terceiro', cron: '0 11 * * 1', messageId: 'msg-a' }],
  }));
  const ok = scheduler.reload();

  assert.equal(ok, true);
  assert.deepEqual(scheduler.activeNames, ['terceiro']);
  assert.equal(
    oldTask.getStatus(),
    'destroyed',
    'a task de "primeiro" deveria ter sido destruída (destroy()), não apenas parada (stop()) — ' +
      'senão ela continua para sempre no registro global do node-cron'
  );
});

test('scheduler.stop() destrói (não apenas para) as tasks ativas', () => {
  const path = newPath();
  writeConfig(path, null); // só "primeiro"

  const scheduler = startScheduler({ schedulesPath: path });

  const before = [...getTasks().values()];
  assert.equal(before.length, 1);
  const task = before[0];

  scheduler.stop();

  assert.equal(
    task.getStatus(),
    'destroyed',
    'stop() do scheduler deveria destruir as tasks, não apenas pará-las'
  );
  assert.deepEqual(scheduler.activeNames, []);
});

// --- Achado 5: boot aborta com config inválida (a metade não coberta pela
// suíte unitária — só o harness phase3 cobria isso, e harness/ é proibido
// de alterar) ---

test('startScheduler() lança com config inválida e nomeia o agendamento problemático (boot aborta)', () => {
  const path = newPath();
  writeFileSync(path, JSON.stringify({
    version: 2,
    defaultGroups: ['1@g.us'],
    messages: [{ id: 'msg-a', name: 'Oi', text: 'Olá!' }],
    schedules: [{ id: 'sch-x', name: 'quebrado', cron: 'não-é-cron', messageId: 'msg-a' }],
  }));

  assert.throws(
    () => startScheduler({ schedulesPath: path }),
    /quebrado/,
    'o erro de boot deveria nomear o agendamento problemático'
  );
});

// --- Achado 6: watchFile não tinha nenhum teste ---
//
// Em macOS (FSEvents), a criação dos arquivos de setup (antes do watcher
// existir) pode ser entregue com atraso — DEPOIS que watchFile já está
// observando — como um evento "eco" para o próprio arquivo observado. Por
// isso cada teste, depois de criar o watcher, espera um período de
// acomodação e zera o contador antes de disparar a ação que está de fato
// sendo testada; sem isso o teste ficaria instável (falso positivo vindo
// do próprio setup, não da ação testada).

async function watchFileAfterSettle(target, run) {
  let calls = 0;
  const watcher = watchFile(target, () => { calls++; });
  try {
    await delay(WATCH_SETTLE_MS); // absorve ecos de eventos do setup
    calls = 0;
    await run();
    await delay(WATCH_SETTLE_MS);
    return calls;
  } finally {
    watcher.close();
  }
}

test('watchFile dispara o callback quando o arquivo observado é escrito', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-watch-'));
  const target = join(dir, 'schedules.json');
  writeFileSync(target, '{}');

  const calls = await watchFileAfterSettle(target, () => {
    writeFileSync(target, '{"a":1}');
  });

  assert.equal(calls, 1, 'onChange deveria ter disparado exatamente uma vez');
});

test('watchFile não dispara para outro arquivo no mesmo diretório', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-watch-'));
  const target = join(dir, 'schedules.json');
  const other = join(dir, 'outro.json');
  writeFileSync(target, '{}');
  writeFileSync(other, '{}');

  const calls = await watchFileAfterSettle(target, () => {
    writeFileSync(other, '{"x":1}');
  });

  assert.equal(calls, 0, 'onChange não deveria disparar para um arquivo diferente do observado');
});

test('watchFile sobrevive a uma gravação atômica (.tmp + rename), que troca o inode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-watch-'));
  const target = join(dir, 'schedules.json');
  writeFileSync(target, '{}');

  const calls = await watchFileAfterSettle(target, () => {
    // Mesma técnica de escrita atômica da tela (Task 3): grava num .tmp e
    // troca com rename(). Isso troca o inode do arquivo-alvo — um watch
    // apontado para o arquivo (em vez do diretório) pararia de receber
    // eventos depois disso.
    const tmpFile = `${target}.tmp`;
    writeFileSync(tmpFile, '{"b":2}');
    renameSync(tmpFile, target);
  });

  assert.equal(calls, 1, 'onChange deveria disparar mesmo após a troca de inode pelo rename()');
});

test('watchFile close() impede callback pendente de disparar (sem timer sobrando)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'waha-watch-'));
  const target = join(dir, 'schedules.json');
  writeFileSync(target, '{}');

  let calls = 0;
  const watcher = watchFile(target, () => { calls++; });
  await delay(WATCH_SETTLE_MS); // absorve ecos de eventos do setup
  calls = 0;

  writeFileSync(target, '{"c":3}'); // arma o timer de debounce (200ms)
  watcher.close(); // deveria cancelar o timer antes dele disparar

  await delay(WATCH_SETTLE_MS); // tempo de sobra para o timer ter disparado, se não tivesse sido limpo
  assert.equal(calls, 0, 'close() deveria impedir o callback pendente de disparar');
});

// --- Revisão final: o registro da recarga é atômico de verdade ---
//
// register() promete montar a geração nova INTEIRA antes de tocar na antiga,
// para que uma falha no meio do laço deixe a configuração anterior intacta e
// ativa. O teste que levava esse nome ("reload com config inválida preserva a
// anterior") usa JSON quebrado, que falha em loadSchedules — antes de
// register() sequer ser chamado. Mover o destroy() da geração antiga para
// ANTES da criação da nova passava na suíte inteira.
//
// Para falhar DENTRO do laço sem tocar em src/: a expressão cron é validada
// em loadSchedules contra o fuso da config do processo, enquanto register()
// registra com o fuso do cfg injetado. Um cfg cujo timezone fica inválido
// depois do boot faz scheduleCron lançar exatamente onde interessa — é o que
// acontece de verdade quando node-cron recusa registrar o que o arquivo
// aceitou.

test('falha ao registrar na recarga preserva a geração anterior intacta', (t) => {
  const path = newPath();
  writeConfig(path, null); // só "primeiro"

  const cfg = { timezone: 'UTC' };
  const scheduler = startScheduler({ schedulesPath: path, cfg });
  t.after(() => scheduler.stop());

  assert.equal(getTasks().size, 1);
  const oldTask = [...getTasks().values()][0];

  cfg.timezone = 'Zona/Inexistente'; // o registro da geração nova vai lançar
  writeConfig(path, '0 10 * * 1'); // config nova, perfeitamente válida no arquivo

  const ok = scheduler.reload();

  assert.equal(ok, false, 'a recarga tem que reportar falha');
  assert.deepEqual(scheduler.activeNames, ['primeiro'], 'a geração anterior continua ativa');
  assert.notEqual(
    oldTask.getStatus(),
    'destroyed',
    'a task da geração anterior não pode ser destruída por uma recarga que nem chegou a registrar a nova'
  );
  assert.equal(getTasks().size, 1, 'nenhuma task a mais pode ter ficado no registro do node-cron');
});

test('falha no MEIO do laço destrói as tasks novas já criadas e preserva a geração anterior', (t) => {
  const path = newPath();
  writeConfig(path, null); // só "primeiro"

  const cfg = { timezone: 'UTC' };
  const scheduler = startScheduler({ schedulesPath: path, cfg });
  t.after(() => scheduler.stop());

  assert.equal(getTasks().size, 1);
  const oldTask = [...getTasks().values()][0];

  // Válido na primeira leitura, inválido daí em diante: na recarga, o
  // agendamento "primeiro" da geração nova é criado e o "segundo" lança —
  // a falha cai no meio do laço, com uma task nova já na mão.
  let reads = 0;
  Object.defineProperty(cfg, 'timezone', {
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? 'UTC' : 'Zona/Inexistente';
    },
  });

  writeConfig(path, '0 10 * * 1'); // agora com "primeiro" e "segundo"
  const ok = scheduler.reload();

  assert.equal(reads > 1, true, 'a recarga precisa ter chegado ao segundo agendamento');
  assert.equal(ok, false, 'a recarga tem que reportar falha');
  assert.deepEqual(scheduler.activeNames, ['primeiro'], 'a geração anterior continua ativa');
  assert.notEqual(
    oldTask.getStatus(),
    'destroyed',
    'a geração anterior não pode ser destruída por uma recarga que falhou no meio'
  );
  assert.equal(
    getTasks().size,
    1,
    'a task nova já criada tem que ter sido destruída: só a geração anterior pode continuar registrada'
  );
});
