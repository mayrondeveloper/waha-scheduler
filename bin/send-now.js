#!/usr/bin/env node
// CLI: dispara uma mensagem imediatamente para os grupos informados.

import { config } from '../src/config.js';
import { broadcast } from '../src/broadcast.js';
import { loadSchedules } from '../src/schedules.js';
import { error } from '../src/logger.js';

const USAGE = `Uso: node bin/send-now.js --message "texto" [--groups "id1,id2"]

  -m, --message   Texto da mensagem (obrigatório).
  -g, --groups    Ids dos grupos separados por vírgula.
                  Se omitido, usa "defaultGroups" de ${config.schedulesPath}.
  -h, --help      Mostra esta ajuda.`;

function parseArgs(argv) {
  const options = { message: null, groups: null, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-m' || arg === '--message') {
      options.message = argv[++i] ?? null;
    } else if (arg === '-g' || arg === '--groups') {
      options.groups = argv[++i] ?? null;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (err) {
  error(err.message);
  console.error(USAGE);
  process.exit(1);
}

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

if (!options.message || !options.message.trim()) {
  error('É obrigatório informar a mensagem com --message.');
  console.error(USAGE);
  process.exit(1);
}

let groups;
if (options.groups) {
  groups = options.groups.split(',');
} else {
  try {
    groups = loadSchedules().defaultGroups;
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

if (groups.length === 0) {
  error('Nenhum grupo de destino: use --groups ou defina "defaultGroups" no schedules.json.');
  process.exit(1);
}

try {
  const { sent, failed, results } = await broadcast(options.message, groups, { label: 'send-now' });

  console.log(`\nResumo: ${sent} enviada(s), ${failed} falha(s), ${results.length} total.`);
  for (const result of results.filter((r) => r.status === 'error')) {
    console.log(`  falha em ${result.chatId}: ${result.error}`);
  }

  process.exit(sent > 0 || failed === 0 ? 0 : 1);
} catch (err) {
  error(err.message);
  process.exit(1);
}
