// Processo principal: registra os agendamentos e recarrega quando o arquivo muda.

import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { schedule as scheduleCron } from 'node-cron';
import { config } from './config.js';
import { loadSchedules, dueAction, GRACE_MS } from './schedules.js';
import { broadcast } from './broadcast.js';
import { info, warn, error, success } from './logger.js';
import { statusPathFor, writeStatus, removeStatus, HEARTBEAT_MS } from './scheduler-status.js';
import { mediaDirFor, mediaPath } from './media.js';
import { updateStore } from './store.js';

export { dueAction, GRACE_MS };

const RELOAD_DEBOUNCE_MS = 200;

/** Intervalo com que o agendador confere os envios únicos vencidos. */
export const TICK_MS = 30_000;

// Envios únicos que ainda podem disparar: habilitados, sem resultado.
function pendingOneShots(schedules) {
  return schedules.filter((s) => s.at && s.enabled && !s.firedAt && !s.missedAt);
}

/**
 * Registra os agendamentos de um arquivo e permite recarregá-los.
 * Na recarga, uma configuração inválida preserva a anterior — diferente do
 * boot, onde ela aborta o processo. Enquanto roda, grava o arquivo de status
 * que a tela lê para saber se os envios vão sair. Os envios únicos ("at")
 * são conferidos por um tique periódico, e o resultado (disparado ou
 * perdido) é gravado no próprio arquivo de agendamentos.
 * @param {{schedulesPath?: string, cfg?: object, statusPath?: string, heartbeatMs?: number,
 *          tickMs?: number, send?: Function, now?: () => number}} [options]
 *   send: implementação do envio (default: broadcast), injetável nos testes.
 * @returns {{reload: () => boolean, stop: () => void, tick: () => Promise<void>, activeNames: string[]}}
 */
export function startScheduler(options = {}) {
  const {
    schedulesPath = config.schedulesPath,
    cfg = config,
    statusPath = statusPathFor(schedulesPath),
    heartbeatMs = HEARTBEAT_MS,
    tickMs = TICK_MS,
    send = broadcast,
    now = Date.now,
  } = options;
  let tasks = [];
  let oneShots = [];
  const startedAt = new Date().toISOString();
  let reloadError = null;
  let statusFailing = false;

  // Status é informação para a tela, nunca motivo para derrubar o
  // agendador: a falha ao gravar é logada uma vez e os disparos seguem.
  function beat() {
    try {
      writeStatus(statusPath, {
        pid: process.pid,
        startedAt,
        beatAt: new Date().toISOString(),
        active: [...tasks.map((t) => t.name), ...oneShots.map((s) => s.name)],
        oneShots: oneShots.map((s) => s.name),
        reloadError,
      });
      if (statusFailing) info(`Status do agendador voltou a ser gravado em ${statusPath}.`);
      statusFailing = false;
    } catch (err) {
      if (!statusFailing) error(`${err.message}. Os agendamentos continuam disparando.`);
      statusFailing = true;
    }
  }

  // Dispara um agendamento (pelo cron ou pelo tique), sem deixar erro subir:
  // uma falha no envio é logada, e o processo segue com os demais.
  async function dispatch(item) {
    info(`Disparando agendamento "${item.name}" para ${item.targets.length} grupo(s).`);
    try {
      // O anexo é lido do disco na hora do disparo, pelo caminho que
      // a tela gravou ao lado do arquivo de agendamentos.
      const media = item.media
        ? { ...item.media, path: mediaPath(mediaDirFor(schedulesPath), item.media) }
        : null;
      const { sent, failed } = await send(item.message, item.targets, {
        cfg,
        label: item.name,
        media,
      });
      success(`Agendamento "${item.name}": ${sent} enviada(s), ${failed} falha(s).`);
    } catch (err) {
      error(`Agendamento "${item.name}" falhou: ${err.message}`);
    }
  }

  // Grava o resultado de um envio único no arquivo. A gravação dispara o
  // watcher e uma recarga, que é inofensiva: ela só reflete o que já está
  // em memória.
  async function markOneShot(id, field) {
    await updateStore(schedulesPath, (store) => {
      const target = store.schedules.find((s) => s.id === id);
      if (target) target[field] = new Date(now()).toISOString();
      return store;
    });
  }

  let ticking = false;

  // Confere os envios únicos vencidos. O resultado é gravado ANTES do envio,
  // para um tique seguinte (ou um reinício no meio) não disparar de novo.
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const item of [...oneShots]) {
        const action = dueAction(item, now(), cfg.timezone);
        if (action === 'wait' || action === 'done') continue;
        oneShots = oneShots.filter((s) => s.id !== item.id);
        try {
          if (action === 'missed') {
            await markOneShot(item.id, 'missedAt');
            warn(`Envio único "${item.name}" perdido: o horário ${item.at} passou há mais de ${GRACE_MS / 60_000} minutos.`);
            continue;
          }
          await markOneShot(item.id, 'firedAt');
        } catch (err) {
          error(`Não foi possível gravar o resultado do envio único "${item.name}": ${err.message}. O envio não vai sair.`);
          continue;
        }
        await dispatch(item);
      }
    } finally {
      ticking = false;
      beat();
    }
  }

  function register(schedules) {
    // Monta a nova geração de tasks ANTES de tocar na anterior: se algo
    // falhar no meio do laço, a config antiga continua intacta e ativa —
    // é o que permite reload() preservá-la em vez de ficar com um estado
    // meio-aplicado (metade da geração antiga descartada, metade da nova
    // no ar).
    const newTasks = [];

    for (const item of schedules) {
      if (!item.enabled) {
        warn(`Agendamento "${item.name}" está desabilitado — ignorado.`);
        continue;
      }
      if (item.at) {
        if (item.firedAt || item.missedAt) continue;
        info(`Envio único "${item.name}" pendente para ${item.at} (${item.targets.length} grupo(s)).`);
        continue;
      }

      let task;
      try {
        task = scheduleCron(item.cron, () => dispatch(item), { timezone: cfg.timezone });
      } catch (err) {
        // Descarta o que já foi criado nesta tentativa (não é nem a
        // geração antiga, nem uma nova geração válida) e propaga com o
        // nome do agendamento problemático.
        for (const { task: created } of newTasks) created.destroy();
        throw new Error(`Agendamento "${item.name}": falha ao registrar - ${err.message}`);
      }

      newTasks.push({ name: item.name, task });
      info(`Agendamento "${item.name}" registrado: "${item.cron}" (${item.targets.length} grupo(s)).`);
    }

    // Só agora, com a nova geração inteira criada com sucesso, descarta a
    // anterior. task.stop() apenas pausa a execução — o node-cron 4.x
    // mantém a task no registro global (getTasks()) até destroy() ser
    // chamado. Sem isso, cada recarga abandonaria a geração anterior para
    // sempre (closure com mensagem, groups e cfg retidos indefinidamente).
    for (const { task } of tasks) task.destroy();
    tasks = newTasks;
    oneShots = pendingOneShots(schedules);
  }

  // Primeira carga: deixa o erro subir, para o boot poder abortar.
  register(loadSchedules(schedulesPath).schedules);
  beat();
  // unref: os timers sozinhos não mantêm o processo vivo — quem mantém são
  // os crons e o watcher do arquivo. Um envio único pendente sem cron
  // nenhum precisa de um timer com ref, senão o processo encerraria antes.
  const heartbeat = setInterval(beat, heartbeatMs);
  heartbeat.unref();
  const ticker = setInterval(tick, tickMs);
  if (tasks.length > 0) ticker.unref();
  // Um envio único já vencido dispara logo no boot, não daqui a um tique.
  const firstTick = setTimeout(tick, 0);
  firstTick.unref();

  return {
    reload() {
      try {
        const loaded = loadSchedules(schedulesPath);
        register(loaded.schedules);
      } catch (err) {
        error(`Recarga ignorada, mantendo a configuração anterior: ${err.message}`);
        reloadError = err.message;
        beat();
        return false;
      }
      reloadError = null;
      beat();
      success(`Configuração recarregada: ${tasks.length + oneShots.length} agendamento(s) ativo(s).`);
      return true;
    },
    stop() {
      clearInterval(heartbeat);
      clearInterval(ticker);
      clearTimeout(firstTick);
      for (const { task } of tasks) task.destroy();
      tasks = [];
      oneShots = [];
      try {
        removeStatus(statusPath);
      } catch (err) {
        error(err.message);
      }
    },
    tick,
    get activeNames() {
      return [...tasks.map((t) => t.name), ...oneShots.map((s) => s.name)];
    },
  };
}

/**
 * Observa o diretório do arquivo e chama onChange quando ele muda.
 * Observa o diretório, e não o arquivo, porque a escrita atômica troca o
 * inode e mataria um watch apontado para o arquivo.
 * @param {string} filePath Arquivo a observar.
 * @param {() => void} onChange Chamado após o debounce.
 * @returns {{close: () => void}}
 */
export function watchFile(filePath, onChange) {
  const target = resolve(filePath);
  const name = basename(target);
  const dir = dirname(target);
  let timer = null;

  const watcher = watch(dir, (_event, changed) => {
    if (changed && changed !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, RELOAD_DEBOUNCE_MS);
  });

  // FSWatcher é um EventEmitter: um evento 'error' sem listener lança e
  // derruba o processo. Acontece de verdade em Linux/Docker (ENOSPC por
  // limite de inotify, diretório removido ou substituído). O processo
  // precisa seguir vivo disparando o que já está registrado, mesmo tendo
  // perdido a capacidade de observar o arquivo.
  watcher.on('error', (err) => {
    error(
      `Erro ao observar ${dir}: ${err.message}. As recargas automáticas de "${target}" pararam — ` +
        'os agendamentos já registrados continuam disparando normalmente. Reinicie o processo para restaurá-las.'
    );
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

// Executado apenas quando este arquivo é o entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  let scheduler;
  try {
    scheduler = startScheduler();
  } catch (err) {
    error(err.message);
    error('Corrija o arquivo de agendamentos e inicie novamente.');
    process.exit(1);
  }

  if (scheduler.activeNames.length === 0) {
    warn('Nenhum agendamento ativo. Habilite ao menos um em "schedules" para manter o serviço.');
    scheduler.stop();
    process.exit(0);
  }

  const watcher = watchFile(config.schedulesPath, () => scheduler.reload());

  success(
    `Scheduler no ar: ${scheduler.activeNames.length} agendamento(s) ativo(s), ` +
      `fuso ${config.timezone}, WAHA em ${config.wahaUrl}.`
  );
  info(`Observando ${config.schedulesPath} — alterações valem sem reiniciar.`);

  const shutdown = (signal) => {
    info(`Recebido ${signal}, encerrando os agendamentos.`);
    watcher.close();
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
