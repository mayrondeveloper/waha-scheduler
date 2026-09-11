import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCron, parseCron, describeCron } from '../public/cron.js';

test('dias e horário viram cron, com o domingo como 0', () => {
  assert.equal(buildCron([1, 3, 5], '09:00'), '0 9 * * 1,3,5');
  assert.equal(buildCron([6, 0], '18:30'), '30 18 * * 0,6');
});

test('todos os dias marcados viram "*" no dia da semana', () => {
  assert.equal(buildCron([0, 1, 2, 3, 4, 5, 6], '07:05'), '5 7 * * *');
});

test('cron de dias e horário volta para o formulário, com faixas e domingo como 7', () => {
  assert.deepEqual(parseCron('0 9 * * 1-5'), { days: [1, 2, 3, 4, 5], time: '09:00' });
  assert.deepEqual(parseCron('30 18 * * 7'), { days: [0], time: '18:30' });
  assert.deepEqual(parseCron('5 7 * * *'), { days: [0, 1, 2, 3, 4, 5, 6], time: '07:05' });
});

test('cron que não cabe em dias e horário não é convertido', () => {
  const custom = ['*/15 * * * *', '0 9 1 * *', '0 9 * 1 *', '0 0 9 * * 1', '0 9 * * MON', '0 9-18 * * 1', '0 24 * * 1'];
  for (const expr of custom) {
    assert.equal(parseCron(expr), null, `"${expr}" não pode virar dias e horário`);
  }
});

test('a lista descreve quando o agendamento dispara, com a semana começando na segunda', () => {
  assert.equal(describeCron('0 9 * * 1,3,5'), 'Seg, Qua e Sex às 09:00');
  assert.equal(describeCron('0 9 * * *'), 'Todo dia às 09:00');
  assert.equal(describeCron('5 7 * * 0'), 'Dom às 07:05');
  assert.equal(describeCron('0 9 * * 0,6'), 'Sáb e Dom às 09:00');
  assert.equal(describeCron('*/15 * * * *'), null, 'cron personalizado não tem descrição');
});
