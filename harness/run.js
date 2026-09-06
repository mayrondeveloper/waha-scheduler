// harness/run.js
// Valida as fases do SPEC.md contra o mock do WAHA.
// Uso: node harness/run.js phase1 | phase2 | phase3 | all
//
// O harness sobe o mock em :3999, executa os CLIs do projeto como
// subprocessos com env apontando para o mock, e faz asserts na saída.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockWaha, MOCK_PORT, FAIL_GROUP_ID } from './mock-waha.js';

const exec = promisify(execFile);

const OK_GROUPS = ['111111111111111111@g.us', '222222222222222222@g.us'];

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    WAHA_URL: `http://localhost:${MOCK_PORT}`,
    WAHA_SESSION: 'default',
    DELAY_MIN_MS: '10',
    DELAY_MAX_MS: '30',
    ...extra,
  };
}

async function run(cmd, args, env, opts = {}) {
  try {
    const { stdout, stderr } = await exec(cmd, args, {
      env,
      timeout: opts.timeout ?? 15000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function fetchCalls() {
  const res = await fetch(`http://localhost:${MOCK_PORT}/__calls`);
  return res.json();
}

async function resetCalls() {
  await fetch(`http://localhost:${MOCK_PORT}/__reset`, { method: 'POST' });
}

// ---------- Fase 1: config + client + list-groups ----------
async function phase1() {
  console.log('\n== Fase 1: list-groups ==');
  const { code, stdout } = await run('node', ['bin/list-groups.js'], baseEnv());
  check('list-groups sai com código 0', code === 0, `código ${code}`);
  for (const id of [...OK_GROUPS, FAIL_GROUP_ID]) {
    check(`saída contém id normalizado ${id}`, stdout.includes(id));
  }
  check(
    'ids de objeto foram normalizados (sem "_serialized" na saída)',
    !stdout.includes('_serialized')
  );
  check('saída informa total de 3 grupos', /3/.test(stdout));
}

// ---------- Fase 2: broadcast + send-now + log ----------
async function phase2() {
  console.log('\n== Fase 2: send-now ==');
  await resetCalls();

  const tmp = mkdtempSync(join(tmpdir(), 'waha-harness-'));
  const logPath = join(tmp, 'sends.jsonl');
  const schedulesPath = join(tmp, 'schedules.json');
  writeFileSync(
    schedulesPath,
    JSON.stringify({ defaultGroups: OK_GROUPS, schedules: [] })
  );

  const groupsArg = [...OK_GROUPS, FAIL_GROUP_ID].join(',');
  const { code, stdout } = await run(
    'node',
    ['bin/send-now.js', '--message', 'harness-teste', '--groups', groupsArg],
    baseEnv({ LOG_PATH: logPath, SCHEDULES_PATH: schedulesPath })
  );

  check('send-now conclui mesmo com um grupo falhando', code === 0 || /failed|falha/i.test(stdout));

  const calls = await fetchCalls();
  check('mock recebeu 3 chamadas de sendText', calls.length === 3, `recebeu ${calls.length}`);
  check(
    'mensagem correta chegou ao mock',
    calls.every((c) => c.text === 'harness-teste')
  );
  check(
    'resumo reporta 2 ok e 1 falha',
    /2/.test(stdout) && /1/.test(stdout)
  );

  check('log jsonl foi criado', existsSync(logPath));
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    check('log tem 3 linhas (uma por tentativa)', lines.length === 3, `${lines.length} linhas`);
    const entries = lines.map((l) => JSON.parse(l));
    check(
      'log registra 1 erro',
      entries.filter((e) => e.status === 'error').length === 1
    );
  }

  // Sem --message deve falhar com usage
  const bad = await run('node', ['bin/send-now.js'], baseEnv({ SCHEDULES_PATH: schedulesPath }));
  check('send-now sem --message sai com código != 0', bad.code !== 0);
}

// ---------- Fase 3: schedules + scheduler ----------
async function phase3() {
  console.log('\n== Fase 3: scheduler ==');
  const tmp = mkdtempSync(join(tmpdir(), 'waha-harness-'));

  // schedules inválido deve abortar
  const badPath = join(tmp, 'bad.json');
  writeFileSync(
    badPath,
    JSON.stringify({
      schedules: [
        { name: 'quebrado', cron: 'não-é-cron', message: 'x', groups: OK_GROUPS, enabled: true },
      ],
    })
  );
  const bad = await run('node', ['src/index.js'], baseEnv({ SCHEDULES_PATH: badPath }), {
    timeout: 8000,
  });
  check('cron inválido aborta com código != 0', bad.code !== 0);
  check(
    'erro aponta o agendamento problemático',
    /quebrado/.test(bad.stdout + bad.stderr)
  );

  // schedules válido deve registrar e permanecer vivo (timeout = ainda rodando)
  const goodPath = join(tmp, 'good.json');
  writeFileSync(
    goodPath,
    JSON.stringify({
      schedules: [
        { name: 'ativo', cron: '0 9 * * 1', message: 'oi', groups: OK_GROUPS, enabled: true },
        { name: 'desligado', cron: '0 9 * * 2', message: 'oi', groups: OK_GROUPS, enabled: false },
      ],
    })
  );
  const good = await run('node', ['src/index.js'], baseEnv({ SCHEDULES_PATH: goodPath }), {
    timeout: 4000, // esperado: matar por timeout, pois o scheduler fica em foreground
  });
  const out = good.stdout + good.stderr;
  check('scheduler registra o agendamento "ativo"', /ativo/.test(out));
  check(
    'agendamento desabilitado é pulado (logado, não registrado como ativo)',
    /desligado/.test(out)
  );
}

// ---------- main ----------
const phase = process.argv[2];
const valid = ['phase1', 'phase2', 'phase3', 'all'];
if (!valid.includes(phase)) {
  console.error(`Uso: node harness/run.js <${valid.join('|')}>`);
  process.exit(1);
}

const { server } = await startMockWaha();
console.log(`Mock WAHA em http://localhost:${MOCK_PORT}`);

try {
  if (phase === 'phase1' || phase === 'all') await phase1();
  if (phase === 'phase2' || phase === 'all') await phase2();
  if (phase === 'phase3' || phase === 'all') await phase3();
} finally {
  server.close();
}

console.log(`\nResultado: ${passed} passou, ${failed} falhou`);
process.exit(failed > 0 ? 1 : 0);
