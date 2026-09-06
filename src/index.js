// Processo principal: registra os agendamentos do schedules.json e fica em execução.

import { schedule as scheduleCron } from 'node-cron';
import { config } from './config.js';
import { loadSchedules } from './schedules.js';
import { broadcast } from './broadcast.js';
import { info, warn, error, success } from './logger.js';

let loaded;
try {
  loaded = loadSchedules();
} catch (err) {
  error(err.message);
  error('Corrija o arquivo de agendamentos e inicie novamente.');
  process.exit(1);
}

const { schedules } = loaded;

if (schedules.length === 0) {
  warn(`Nenhum agendamento definido em ${config.schedulesPath}. Nada a fazer.`);
  process.exit(0);
}

const tasks = [];

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
        const { sent, failed } = await broadcast(item.message, item.groups, { label: item.name });
        success(`Agendamento "${item.name}": ${sent} enviada(s), ${failed} falha(s).`);
      } catch (err) {
        error(`Agendamento "${item.name}" falhou: ${err.message}`);
      }
    },
    { timezone: config.timezone }
  );

  tasks.push({ name: item.name, task });
  info(`Agendamento "${item.name}" registrado: "${item.cron}" (${item.groups.length} grupo(s)).`);
}

if (tasks.length === 0) {
  warn('Nenhum agendamento ativo. Habilite ao menos um em "schedules" para manter o serviço.');
  process.exit(0);
}

success(
  `Scheduler no ar: ${tasks.length} agendamento(s) ativo(s), fuso ${config.timezone}, WAHA em ${config.wahaUrl}.`
);

function shutdown(signal) {
  info(`Recebido ${signal}, encerrando os agendamentos.`);
  for (const { task } of tasks) {
    task.stop();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
