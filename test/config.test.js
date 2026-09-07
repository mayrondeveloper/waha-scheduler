import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('aplica defaults quando o ambiente está vazio', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.wahaUrl, 'http://localhost:3000');
  assert.equal(cfg.session, 'default');
  assert.equal(cfg.schedulesPath, './data/schedules.json');
  assert.equal(cfg.logPath, './logs/sends.jsonl');
  assert.equal(cfg.delayMinMs, 3000);
  assert.equal(cfg.delayMaxMs, 8000);
});

test('lê valores do ambiente e remove barras finais da URL', () => {
  const cfg = loadConfig({ WAHA_URL: 'http://waha.local:3000///', WAHA_SESSION: 'vendas' });
  assert.equal(cfg.wahaUrl, 'http://waha.local:3000');
  assert.equal(cfg.session, 'vendas');
});

test('rejeita delay não numérico', () => {
  assert.throws(() => loadConfig({ DELAY_MIN_MS: 'abc' }), /DELAY_MIN_MS inválida/);
});

test('rejeita delay máximo menor que o mínimo', () => {
  assert.throws(
    () => loadConfig({ DELAY_MIN_MS: '5000', DELAY_MAX_MS: '1000' }),
    /não pode ser menor/
  );
});

test('o objeto de configuração é imutável', () => {
  const cfg = loadConfig({});
  assert.throws(() => {
    cfg.session = 'outra';
  }, TypeError);
});

test('rejeita TIMEZONE inválido apontando a variável, não o cron', () => {
  // O erro tem que nomear TIMEZONE: antes, um fuso inválido só aparecia mais
  // tarde, disfarçado de "expressão cron inválida", mandando o usuário
  // procurar o defeito no schedules.json em vez de no .env.
  assert.throws(() => loadConfig({ TIMEZONE: 'America/SaoPaulo' }), /TIMEZONE inválida/);
  assert.throws(() => loadConfig({ TIMEZONE: 'nao-existe/Nenhum' }), /TIMEZONE inválida/);
});

test('aceita fusos válidos e trata valor em branco como ausente', () => {
  assert.equal(loadConfig({ TIMEZONE: 'Asia/Tokyo' }).timezone, 'Asia/Tokyo');
  assert.equal(loadConfig({ TIMEZONE: 'UTC' }).timezone, 'UTC');
  assert.equal(loadConfig({ TIMEZONE: '   ' }).timezone, 'America/Sao_Paulo');
});
