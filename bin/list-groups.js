#!/usr/bin/env node
// CLI: lista os grupos disponíveis na sessão do WAHA com seus ids normalizados.

import { config } from '../src/config.js';
import { listGroups } from '../src/waha/client.js';
import { error } from '../src/logger.js';

try {
  const groups = await listGroups();

  if (groups.length === 0) {
    console.log(`Nenhum grupo encontrado na sessão "${config.session}".`);
    process.exit(0);
  }

  console.log(`Grupos da sessão "${config.session}":\n`);
  const width = Math.max(...groups.map((g) => g.id.length));
  for (const group of groups) {
    console.log(`  ${group.id.padEnd(width)}  ${group.name}`);
  }
  console.log(`\nTotal: ${groups.length} grupo(s).`);
} catch (err) {
  error(err.message);
  process.exit(1);
}
