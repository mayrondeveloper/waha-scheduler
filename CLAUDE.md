# CLAUDE.md — waha-scheduler

Convenções e regras para trabalhar neste projeto. A fonte da verdade funcional é o SPEC.md.

## Regras gerais

- Implemente UMA fase do SPEC.md por vez. Nunca avance de fase sem o harness da fase atual passar.
- Antes de dar a fase como concluída, rode: `node harness/run.js <fase>` (ex: `node harness/run.js phase1`).
- NUNCA envie mensagens reais durante desenvolvimento. Todo teste usa o mock do harness (`WAHA_URL=http://localhost:3999`). Envio real só quando o usuário pedir explicitamente.
- Não adicione dependências além de `node-cron` e `dotenv` sem perguntar antes.
- Não crie abstrações especulativas (classes, factories, camadas extras). Funções simples exportadas por módulo.

## Código

- ES Modules, Node 18+, `fetch` nativo.
- Nomes de arquivos, variáveis e funções em inglês; mensagens de log e erros voltados ao usuário em português.
- Erros: sempre lançar `Error` com contexto (`Erro 500 ao enviar para 123@g.us: ...`). Nunca engolir erro silenciosamente.
- Sem `console.log` solto: todo output passa pelo logger.js (exceto os CLIs em bin/, que imprimem resultado direto).
- JSDoc apenas nas funções exportadas.

## Ajustes de testabilidade (complementam o SPEC.md)

- O caminho do schedules.json pode ser sobrescrito pela env `SCHEDULES_PATH` (default: `./schedules.json`). O harness usa isso para injetar arquivos de teste.
- O caminho do log pode ser sobrescrito pela env `LOG_PATH` (default: `./logs/sends.jsonl`).
- `broadcast.js` deve aceitar o client como parâmetro injetável (default: o waha.client real) para permitir mock em teste unitário.

## O que NÃO fazer

- Não usar axios, express, TypeScript, ORM ou framework de teste externo.
- Não implementar retry automático, fila ou webhook (fora de escopo, ver não-objetivos do SPEC).
- Não commitar .env, logs/ ou node_modules (garanta o .gitignore na Fase 1).
- Não alterar o SPEC.md nem os arquivos de harness/ para "fazer o teste passar". Se um teste do harness parecer errado, pare e pergunte ao usuário.

## Fluxo de validação por fase

| Fase | Comando |
|---|---|
| 1 | `node harness/run.js phase1` |
| 2 | `node harness/run.js phase2` |
| 3 | `node harness/run.js phase3` |
| 4 | `npm test` e depois `node harness/run.js all` |

Ao final de cada fase, apresente um resumo curto: o que foi criado, resultado do harness, e aguarde aprovação para a próxima fase.
