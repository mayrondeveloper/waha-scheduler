import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('aplica defaults quando o ambiente está vazio', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.wahaUrl, 'http://localhost:3000');
  assert.equal(cfg.session, 'default');
  assert.equal(cfg.schedulesPath, './schedules.json');
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
