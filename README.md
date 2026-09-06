# waha-scheduler

Agendador de mensagens para grupos de WhatsApp via [WAHA](https://waha.devlike.pro/).
Lê os agendamentos de um `schedules.json`, dispara nos horários definidos por cron
e registra cada tentativa de envio em um log JSONL.

## Requisitos

- Node.js 18+ (usa `fetch` nativo e ES Modules)
- Uma instância do WAHA acessível com uma sessão de WhatsApp conectada

## Instalação

```bash
npm install
cp .env.example .env
mkdir -p data && cp schedules.example.json data/schedules.json
```

Ajuste o `.env` com a URL e a sessão do seu WAHA.

## Configuração

Todas as opções vêm de variáveis de ambiente (ver `.env.example`):

| Variável | Default | Descrição |
|---|---|---|
| `WAHA_URL` | `http://localhost:3000` | URL base da instância WAHA |
| `WAHA_SESSION` | `default` | Nome da sessão do WhatsApp |
| `WAHA_API_KEY` | vazio | Enviada no header `X-Api-Key` quando preenchida |
| `SCHEDULES_PATH` | `./data/schedules.json` | Arquivo de agendamentos |
| `LOG_PATH` | `./logs/sends.jsonl` | Log de envios em JSONL |
| `DELAY_MIN_MS` | `3000` | Intervalo mínimo entre envios |
| `DELAY_MAX_MS` | `8000` | Intervalo máximo entre envios |
| `TIMEZONE` | `America/Sao_Paulo` | Fuso usado pelos agendamentos |

O intervalo aleatório entre `DELAY_MIN_MS` e `DELAY_MAX_MS` é aplicado entre um
grupo e o seguinte, para evitar bloqueio por flood.

## Uso

### Descobrir os ids dos grupos

```bash
npm run list-groups
```

Os ids saem já normalizados (o WAHA devolve `id` ora como texto, ora como
objeto `{ _serialized }`, dependendo do engine).

### Enviar agora

```bash
node bin/send-now.js --message "Reunião às 14h" --groups "123@g.us,456@g.us"
```

Sem `--groups`, usa o `defaultGroups` do `schedules.json`. Um grupo que falha
não interrompe os demais: o resumo final informa quantos foram enviados e
quantos falharam.

### Rodar o agendador

```bash
npm start
```

O processo fica em foreground, registra os agendamentos habilitados e dispara
nos horários definidos. `Ctrl+C` encerra os agendamentos com segurança.

## schedules.json

```json
{
  "defaultGroups": ["123456789@g.us"],
  "schedules": [
    {
      "name": "bom-dia-segunda",
      "cron": "0 9 * * 1",
      "message": "Bom dia! Segue o resumo da semana.",
      "groups": ["123456789@g.us"],
      "enabled": true
    }
  ]
}
```

- `name` — obrigatório e único; identifica o agendamento nos logs.
- `cron` — obrigatório; validado na inicialização. Um cron inválido aborta o
  processo apontando o agendamento problemático.
- `message` — obrigatório.
- `groups` — opcional; quando ausente, herda `defaultGroups`.
- `enabled` — opcional (default `true`); agendamentos desabilitados são
  registrados no log e ignorados.

## Log de envios

Uma linha JSON por tentativa em `LOG_PATH`:

```json
{"ts":"2026-09-06T03:13:58.038Z","status":"sent","chatId":"123@g.us","message":"Bom dia!","label":"bom-dia-segunda"}
```

`status` é `sent` ou `error`; entradas com erro trazem o campo `error` com o
contexto da falha.

## Desenvolvimento

Nenhum teste toca a API real do WhatsApp — tudo passa pelo mock do harness.

```bash
npm test                    # testes unitários (node:test)
npm run harness             # valida todas as fases contra o mock
node harness/run.js phase1  # valida uma fase específica
npm run mock                # sobe só o mock do WAHA em :3999
```

## Estrutura

```
bin/list-groups.js   CLI: lista grupos com ids normalizados
bin/send-now.js      CLI: disparo imediato
src/config.js        Variáveis de ambiente e defaults
src/logger.js        Saída de console e log JSONL de envios
src/waha/client.js   Cliente HTTP do WAHA (único ponto de rede)
src/broadcast.js     Envio para vários grupos, resiliente a falhas
src/schedules.js     Leitura e validação do schedules.json
src/index.js         Processo do agendador
harness/             Mock do WAHA e validação por fase
```
