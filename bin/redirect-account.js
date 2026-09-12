#!/usr/bin/env node
// CLI: cria uma conta no redirecionador e imprime a chave, uma única vez.
// Uso: node bin/redirect-account.js "Nome da conta"

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadRedirectConfig } from '../src/redirect/config.js';
import { openDb } from '../src/redirect/db.js';
import { error } from '../src/logger.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  error('Informe o nome da conta: node bin/redirect-account.js "Compara Livros"');
  process.exit(1);
}

try {
  const cfg = loadRedirectConfig();
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const db = openDb(cfg.dbPath);
  const account = db.createAccount(name);
  db.close();

  console.log(`Conta "${account.name}" criada (id ${account.id}) em ${cfg.dbPath}.`);
  console.log('');
  console.log('Chave da conta (guarde agora: ela não é mostrada de novo):');
  console.log(`  ${account.key}`);
  console.log('');
  console.log('No .env do agendador:');
  console.log(`  CLICKS_URL=${cfg.publicUrl}`);
  console.log(`  CLICKS_API_KEY=${account.key}`);
} catch (err) {
  error(err.message);
  process.exit(1);
}
