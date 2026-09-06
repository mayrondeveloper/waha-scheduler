// Processo principal: registra os agendamentos e recarrega quando o arquivo muda.

import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { schedule as scheduleCron } from 'node-cron';
import { config } from './config.js';
import { loadSchedules } from './schedules.js';
import { broadcast } from './broadcast.js';
import { info, warn, error, success } from './logger.js';

const RELOAD_DEBOUNCE_MS = 200;

/**
 * Registra os agendamentos de um arquivo e permite recarregá-los.
 * Na recarga, uma configuração inválida preserva a anterior — diferente do
 * boot, onde ela aborta o processo.
 * @param {{schedulesPath?: string, cfg?: object}} [options]
 * @returns {{reload: () => boolean, stop: () => void, activeNames: string[]}}
 */
export function startScheduler(options = {}) {
  const { schedulesPath = config.schedulesPath, cfg = config } = options;
  let tasks = [];

  function register(schedules) {
    for (const { task } of tasks) task.stop();
    tasks = [];

    for (const item of schedules) {
      if (!item.enabled) {
        warn(`Agendamento "${item.name}" está desabilitado — ignorado.`);
        continue;
      }

      const task = scheduleCron(
        item.cron,
        async () => {
          info(`Disparando agendamento "${item.name}" para ${item.groups.length} grupo(s).`);
          try {
            const { sent, failed } = await broadcast(item.message, item.groups, {
              cfg,
              label: item.name,
            });
            success(`Agendamento "${item.name}": ${sent} enviada(s), ${failed} falha(s).`);
          } catch (err) {
            error(`Agendamento "${item.name}" falhou: ${err.message}`);
          }
        },
        { timezone: cfg.timezone }
      );

      tasks.push({ name: item.name, task });
      info(`Agendamento "${item.name}" registrado: "${item.cron}" (${item.groups.length} grupo(s)).`);
    }
  }

  // Primeira carga: deixa o erro subir, para o boot poder abortar.
  register(loadSchedules(schedulesPath).schedules);

  return {
    reload() {
      let loaded;
      try {
        loaded = loadSchedules(schedulesPath);
      } catch (err) {
        error(`Recarga ignorada, mantendo a configuração anterior: ${err.message}`);
        return false;
      }
      register(loaded.schedules);
      success(`Configuração recarregada: ${tasks.length} agendamento(s) ativo(s).`);
      return true;
    },
    stop() {
      for (const { task } of tasks) task.stop();
      tasks = [];
    },
    get activeNames() {
      return tasks.map((t) => t.name);
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
  let timer = null;

  const watcher = watch(dirname(target), (_event, changed) => {
    if (changed && changed !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, RELOAD_DEBOUNCE_MS);
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
