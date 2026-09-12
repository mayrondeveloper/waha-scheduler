// Processo principal: registra os agendamentos e recarrega quando o arquivo muda.

import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { schedule as scheduleCron } from 'node-cron';
import { config } from './config.js';
import { loadSchedules, dueAction, GRACE_MS } from './schedules.js';
import { broadcast } from './broadcast.js';
import { info, warn, error, success, appendSendLog } from './logger.js';
import { statusPathFor, writeStatus, removeStatus, HEARTBEAT_MS } from './scheduler-status.js';
import { mediaDirFor, mediaPath } from './media.js';
import { updateStore } from './store.js';
import { inQuietHours, quietEnd } from './quiet.js';
import { sendAlert } from './alerts.js';
import { prepareDispatch } from './dispatch.js';
import * as wahaClient from './waha/client.js';

export { dueAction, GRACE_MS };

const RELOAD_DEBOUNCE_MS = 200;

/** Intervalo com que o agendador confere os envios únicos e os adiados. */
export const TICK_MS = 30_000;

/** Intervalo com que o agendador consulta a sessão do WAHA. */
export const SESSION_POLL_MS = 60_000;

// Envios únicos que ainda podem disparar: habilitados, sem resultado e sem
// adiamento em curso (o adiado é tratado pela lista de pendentes).
function pendingOneShots(schedules) {
  return schedules.filter((s) => s.at && s.enabled && !s.firedAt && !s.missedAt && !s.pending);
}

// Disparos adiados pela janela de silêncio, de qualquer tipo de agendamento.
function deferred(schedules) {
  return schedules.filter((s) => s.pending && s.enabled);
}

/**
 * Registra os agendamentos de um arquivo e permite recarregá-los.
 * Na recarga, uma configuração inválida preserva a anterior — diferente do
 * boot, onde ela aborta o processo. Enquanto roda, grava o arquivo de status
 * que a tela lê para saber se os envios vão sair. Os envios únicos ("at") e
 * os adiados pela janela de silêncio ("pending") são conferidos por um tique
 * periódico, e o resultado é gravado no próprio arquivo de agendamentos. Um
 * vigia consulta a sessão do WAHA e avisa o dono quando ela cai ou volta.
 * @param {{schedulesPath?: string, cfg?: object, statusPath?: string, heartbeatMs?: number,
 *          tickMs?: number, sessionPollMs?: number, send?: Function, client?: object,
 *          fetchImpl?: typeof fetch, now?: () => number}} [options]
 *   send: implementação do envio (default: broadcast); client: cliente do
 *   WAHA (default: o real); fetchImpl: para a URL de push. Injetáveis nos testes.
 * @returns {{reload: () => boolean, stop: () => void, tick: () => Promise<void>,
 *            pollSession: () => Promise<void>, activeNames: string[]}}
 */
export function startScheduler(options = {}) {
  const {
    schedulesPath = config.schedulesPath,
    cfg = config,
    statusPath = statusPathFor(schedulesPath),
    heartbeatMs = HEARTBEAT_MS,
    tickMs = TICK_MS,
    sessionPollMs = SESSION_POLL_MS,
    send = broadcast,
    client = wahaClient,
    fetchImpl = fetch,
    now = Date.now,
  } = options;
  let tasks = [];
  let oneShots = [];
  let pendings = [];
  let settings = null;
  let session = { status: null, me: null, checkedAt: null, error: null };
  const startedAt = new Date().toISOString();
  let reloadError = null;
  let statusFailing = false;

  const iso = (ms) => new Date(ms).toISOString();

  // Status é informação para a tela, nunca motivo para derrubar o
  // agendador: a falha ao gravar é logada uma vez e os disparos seguem.
  function beat() {
    try {
      writeStatus(statusPath, {
        pid: process.pid,
        startedAt,
        beatAt: iso(now()),
        active: activeNames(),
        oneShots: oneShots.map((s) => s.name),
        pending: pendings.map((s) => s.name),
        paused: Boolean(settings?.paused),
        waha: session,
        reloadError,
      });
      if (statusFailing) info(`Status do agendador voltou a ser gravado em ${statusPath}.`);
      statusFailing = false;
    } catch (err) {
      if (!statusFailing) error(`${err.message}. Os agendamentos continuam disparando.`);
      statusFailing = true;
    }
  }

  function activeNames() {
    return [...new Set([...tasks.map((t) => t.name), ...oneShots.map((s) => s.name), ...pendings.map((s) => s.name)])];
  }

  // Alerta ao dono: disparar e esquecer, nunca derruba nem atrasa nada.
  function alert(channels, title, text) {
    return sendAlert({ title, text, channels }, { settings, cfg, client, me: session.me, fetchImpl });
  }

  // Dispara um agendamento (pelo cron ou pelo tique), sem deixar erro subir:
  // uma falha no envio é logada, e o processo segue com os demais.
  async function dispatch(item, extra = {}) {
    info(`Disparando agendamento "${item.name}" para ${item.targets.length} grupo(s).`);
    try {
      // O anexo é lido do disco na hora do disparo, pelo caminho que
      // a tela gravou ao lado do arquivo de agendamentos.
      const media = item.media
        ? { ...item.media, path: mediaPath(mediaDirFor(schedulesPath), item.media) }
        : null;
      // Identidade do disparo, links rastreáveis e prévia do destino. Com
      // anexo, a prévia não se aplica: a imagem é o anexo.
      const prepared = await prepareDispatch({ schedule: item, message: item.message, targets: item.targets, cfg, client, fetchImpl });
      const result = await send(item.message, item.targets, {
        cfg,
        label: item.name,
        media,
        hourlyLimit: settings?.hourlyLimit ?? 0,
        extra: { ...extra, ...prepared.extra },
        links: prepared.links,
        preview: media ? null : prepared.preview,
      });
      const { sent, failed } = result;
      success(`Agendamento "${item.name}": ${sent} enviada(s), ${failed} falha(s).`);
      if (failed > 0) {
        const first = (result.results ?? []).find((r) => r.status === 'error')?.error ?? 'falha sem detalhe';
        await alert(['whatsapp', 'push'], `Falha no envio: ${item.name}`,
          `${failed} de ${sent + failed} grupo(s) falharam. Primeiro erro: ${first}`);
      }
    } catch (err) {
      error(`Agendamento "${item.name}" falhou: ${err.message}`);
      await alert(['whatsapp', 'push'], `Falha no envio: ${item.name}`, err.message);
    }
  }

  // Pausado: o disparo não sai, e o histórico diz que não saiu e por quê.
  function skip(item, reason) {
    warn(`Agendamento "${item.name}" não disparou: envios pausados.`);
    for (const chatId of item.targets) {
      appendSendLog({ status: 'skipped', chatId, message: item.message, label: item.name, reason }, cfg.logPath);
    }
  }

  // Janela de silêncio: grava o adiamento no arquivo (sobrevive a reinício)
  // e o tique dispara no fim da janela. Um cron que dispara de novo com um
  // adiamento já pendente não empilha outro.
  async function defer(item, nowMs) {
    const at = iso(quietEnd(nowMs, settings.quietHours, cfg.timezone));
    const pending = { at, from: iso(nowMs), reason: 'quiet' };
    let added = false;
    try {
      await updateStore(schedulesPath, (store) => {
        const target = store.schedules.find((s) => s.id === item.id);
        if (target && !target.pending) {
          target.pending = pending;
          added = true;
        }
        return store;
      });
    } catch (err) {
      error(`Agendamento "${item.name}" caiu na janela de silêncio, mas o adiamento não pôde ser gravado: ${err.message}. Este disparo não vai sair.`);
      return;
    }
    if (!added) {
      info(`Agendamento "${item.name}" caiu na janela de silêncio e já tem um adiamento pendente: este disparo não empilha.`);
      return;
    }
    oneShots = oneShots.filter((s) => s.id !== item.id);
    pendings = [...pendings.filter((s) => s.id !== item.id), { ...item, pending }];
    info(`Agendamento "${item.name}" caiu na janela de silêncio: adiado para ${at}.`);
    beat();
  }

  // O que o cron chama.
  async function fire(item) {
    const nowMs = now();
    if (settings?.paused) return skip(item, 'paused');
    if (inQuietHours(nowMs, settings?.quietHours, cfg.timezone)) return defer(item, nowMs);
    await dispatch(item);
  }

  // Grava campos de um agendamento no arquivo. A gravação dispara o watcher
  // e uma recarga, que é inofensiva: ela só reflete o que já está em memória.
  async function mark(id, fields) {
    await updateStore(schedulesPath, (store) => {
      const target = store.schedules.find((s) => s.id === id);
      if (target) {
        for (const [key, value] of Object.entries(fields)) {
          if (value === null) delete target[key];
          else target[key] = value;
        }
      }
      return store;
    });
  }

  let inFlight = null;

  // Confere os adiados e os envios únicos vencidos. O resultado é gravado
  // ANTES do envio, para um tique seguinte (ou um reinício no meio) não
  // disparar de novo. Pausado, nada é avaliado: tudo espera a retomada.
  // Um tique chamado durante outro espera o que está em curso.
  function tick() {
    if (!inFlight) inFlight = runTick().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function runTick() {
    try {
      if (settings?.paused) return;
      const nowMs = now();

      for (const item of [...pendings]) {
        if (Date.parse(item.pending.at) > nowMs) continue;
        pendings = pendings.filter((s) => s.id !== item.id);
        try {
          await mark(item.id, { pending: null, ...(item.at && { firedAt: iso(nowMs) }) });
        } catch (err) {
          error(`Não foi possível gravar o fim do adiamento de "${item.name}": ${err.message}. O envio não vai sair.`);
          continue;
        }
        await dispatch(item, { deferredFrom: item.pending.from });
      }

      for (const item of [...oneShots]) {
        const action = dueAction(item, nowMs, cfg.timezone);
        if (action === 'wait' || action === 'done') continue;
        if (action === 'fire' && inQuietHours(nowMs, settings?.quietHours, cfg.timezone)) {
          await defer(item, nowMs);
          continue;
        }
        oneShots = oneShots.filter((s) => s.id !== item.id);
        try {
          if (action === 'missed') {
            await mark(item.id, { missedAt: iso(nowMs) });
            warn(`Envio único "${item.name}" perdido: o horário ${item.at} passou há mais de ${GRACE_MS / 60_000} minutos.`);
            await alert(['whatsapp', 'push'], `Envio único perdido: ${item.name}`,
              `O horário ${item.at} passou há mais de ${GRACE_MS / 60_000} minutos com o agendador parado. Use "Enviar agora" se ainda valer.`);
            continue;
          }
          await mark(item.id, { firedAt: iso(nowMs) });
        } catch (err) {
          error(`Não foi possível gravar o resultado do envio único "${item.name}": ${err.message}. O envio não vai sair.`);
          continue;
        }
        await dispatch(item);
      }
    } finally {
      beat();
    }
  }

  // Vigia da sessão: transição de conectado para outro estado avisa pela URL
  // de push (o WhatsApp não consegue avisar de si mesmo); a volta avisa nos
  // dois canais. A primeira consulta é só a linha de base.
  async function pollSession() {
    let next;
    try {
      const { status, me } = await client.getSession(cfg);
      next = { status, me, checkedAt: iso(now()), error: null };
    } catch (err) {
      next = { status: null, me: session.me, checkedAt: iso(now()), error: err.message };
    }
    const first = session.checkedAt === null;
    const wasUp = session.status === 'WORKING';
    const isUp = next.status === 'WORKING';
    session = next;
    beat();
    if (first) return;
    if (wasUp && !isUp) {
      const state = next.status ?? 'inacessível';
      warn(`Sessão "${cfg.session}" do WAHA saiu do ar: ${state}${next.error ? ` (${next.error})` : ''}.`);
      await alert(['push'], 'Número desconectado',
        `A sessão "${cfg.session}" está ${state}${next.error ? `: ${next.error}` : ''}. Nada sai até ela reconectar.`);
    } else if (!wasUp && isUp) {
      success(`Sessão "${cfg.session}" do WAHA voltou a funcionar.`);
      await alert(['whatsapp', 'push'], 'Número reconectado', `A sessão "${cfg.session}" voltou a funcionar. Os envios seguem normalmente.`);
    }
  }

  function register(loaded) {
    settings = loaded.settings;
    const schedules = loaded.schedules;
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
      if (item.pending) {
        info(`Agendamento "${item.name}" tem envio adiado para ${item.pending.at} (janela de silêncio).`);
        if (item.at) continue;
      }
      if (item.at) {
        if (item.firedAt || item.missedAt) continue;
        info(`Envio único "${item.name}" pendente para ${item.at} (${item.targets.length} grupo(s)).`);
        continue;
      }

      let task;
      try {
        task = scheduleCron(item.cron, () => fire(item), { timezone: cfg.timezone });
      } catch (err) {
        // Descarta o que já foi criado nesta tentativa (não é nem a
        // geração antiga, nem uma nova geração válida) e propaga com o
        // nome do agendamento problemático.
        for (const { task: created } of newTasks) created.destroy();
        throw new Error(`Agendamento "${item.name}": falha ao registrar - ${err.message}`);
      }

      newTasks.push({ name: item.name, id: item.id, item, task });
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
    pendings = deferred(schedules);
    if (settings.paused) warn('Envios pausados nos ajustes: nenhum disparo sai até a retomada.');
  }

  // Primeira carga: deixa o erro subir, para o boot poder abortar.
  register(loadSchedules(schedulesPath));
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
  const sessionPoll = setInterval(pollSession, sessionPollMs);
  sessionPoll.unref();
  const firstPoll = setTimeout(pollSession, 0);
  firstPoll.unref();

  return {
    reload() {
      try {
        register(loadSchedules(schedulesPath));
      } catch (err) {
        error(`Recarga ignorada, mantendo a configuração anterior: ${err.message}`);
        reloadError = err.message;
        beat();
        return false;
      }
      reloadError = null;
      beat();
      success(`Configuração recarregada: ${activeNames().length} agendamento(s) ativo(s).`);
      return true;
    },
    stop() {
      clearInterval(heartbeat);
      clearInterval(ticker);
      clearTimeout(firstTick);
      clearInterval(sessionPoll);
      clearTimeout(firstPoll);
      for (const { task } of tasks) task.destroy();
      tasks = [];
      oneShots = [];
      pendings = [];
      try {
        removeStatus(statusPath);
      } catch (err) {
        error(err.message);
      }
    },
    tick,
    pollSession,
    // O que o cron chamaria para este agendamento, agora. Para os testes:
    // o cron de verdade só dispara no minuto certo.
    fire(id) {
      const found = tasks.find((t) => t.id === id);
      if (!found) throw new Error(`Agendamento "${id}" não está registrado no cron.`);
      return fire(found.item);
    },
    get activeNames() {
      return activeNames();
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
