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

### Já usava o projeto antes da tela?

Os agendamentos saíram da raiz do repositório para `data/`, que fica fora do
versionamento. Quem tem um `schedules.json` na raiz com ids de grupo reais
precisa movê-lo:

```bash
mkdir -p data && mv schedules.json data/schedules.json
```

O arquivo na raiz era rastreado pelo git e deixou de ser (virou
`schedules.example.json`, com ids de exemplo). Se preferir mantê-lo onde
está, aponte `SCHEDULES_PATH=./schedules.json` no `.env` — o `.gitignore`
já ignora a raiz, para que um `git add .` não publique seus ids num
repositório público. Nada mais muda: o formato antigo continua sendo lido, e
a porta da tela agora é `3010` (era `3000`, a mesma do WAHA).

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
| `UI_PORT` | `3010` | Porta da tela de agendamentos (sempre em `127.0.0.1`) |

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

### Tela de agendamentos

```bash
npm run ui
```

Abre em `http://127.0.0.1:3010`. Permite criar, editar, ligar/desligar e
excluir agendamentos e mensagens, escolher grupos por nome, disparar um envio
na hora e consultar o histórico.

A tela escuta **apenas em localhost** — não é alcançável pela rede local nem
pela internet, e por isso não tem senha. Não existe variável de ambiente para
mudar isso: o host é sempre `127.0.0.1`, sem escotilha por env (não há
`UI_HOST`) — é essa inalcançabilidade de fora que dispensa autenticação
própria numa tela que dispara mensagens de WhatsApp. Para acessar de outra
máquina, use um túnel SSH:

```bash
ssh -L 3010:localhost:3010 usuario@servidor
```

A porta local do túnel precisa casar com a porta em que a tela está
escutando (`UI_PORT`, default `3010`): a tela valida o cabeçalho `Host` da
requisição, então um túnel com portas diferentes (`ssh -L 8080:localhost:3010
...`, por exemplo) resulta em `403 Cabeçalho Host não permitido`.

O default é `3010`, e não `3000`, porque `3000` é a porta default do próprio
WAHA: quem roda o WAHA na mesma máquina bateria em "porta já em uso" ao subir
a tela. Se a porta escolhida estiver ocupada, a tela diz isso em português e
encerra — mude `UI_PORT` no `.env` ou libere a porta.

Além do bind em localhost, a tela tem outras defesas que valem conhecer:

- Métodos que alteram dados (`POST`, `PUT`, `PATCH`, `DELETE`) exigem
  `Content-Type: application/json`; qualquer outro valor, ou a ausência dele,
  responde `415`.
- Os cabeçalhos `Host` e `Origin` são validados a cada requisição — proteção
  contra DNS rebinding e contra o próprio navegador do usuário fazendo
  requisições de outra origem.
- O corpo da requisição tem tamanho limitado; acima do limite a tela responde
  `413`.

O botão "Disparar agora" envia mensagem de verdade quando há um WAHA real
configurado — e funciona mesmo com o agendamento desligado: é uma ação manual
e explícita, com confirmação antes de enviar, pensada para testar um
agendamento antes de ligá-lo. Isso diverge do cron, que pula os agendamentos
desabilitados. Para experimentar sem risco, aponte para o mock:

```bash
npm run dev
```

Rodando `npm start` em paralelo, as alterações feitas na tela passam a valer
em segundos, sem reiniciar o agendador.

Gravar um agendamento pela tela materializa os grupos: se ele herdava
`groups` de `defaultGroups`, a gravação passa a fixar essa lista
explicitamente naquele agendamento. Depois da primeira gravação pela tela,
alterar `defaultGroups` deixa de afetar esse agendamento — é o modo de falha
mais seguro (os destinatários ficam congelados no momento do save), mas vale
saber disso antes de editar `defaultGroups` esperando que o efeito se
propague para agendamentos já salvos pela tela.

## schedules.json

```json
{
  "defaultGroups": ["123456789@g.us"],
  "messages": [
    {
      "id": "msg-a1b2c3d4",
      "name": "bom-dia",
      "text": "Bom dia! Segue o resumo da semana."
    }
  ],
  "schedules": [
    {
      "id": "sch-e5f6a7b8",
      "name": "bom-dia-segunda",
      "cron": "0 9 * * 1",
      "messageId": "msg-a1b2c3d4",
      "groups": ["123456789@g.us"],
      "enabled": true
    }
  ]
}
```

- `messages` — biblioteca de mensagens reutilizáveis; cada uma tem `id`
  (gerado automaticamente quando ausente), `name` e `text`.
- `id` — gerado no servidor quando ausente; identifica agendamento ou mensagem
  de forma estável entre gravações.
- `name` — obrigatório e único (entre agendamentos, e separadamente entre
  mensagens); identifica o agendamento nos logs.
- `cron` — obrigatório; validado na inicialização. Um cron inválido aborta o
  processo apontando o agendamento problemático.
- `messageId` — obrigatório; precisa apontar para um `id` existente em
  `messages`.
- `groups` — opcional; quando ausente, herda `defaultGroups`.
- `enabled` — opcional (default `true`); agendamentos desabilitados são
  ignorados pelo cron (mas continuam disparáveis na hora, pela tela).

### Formato antigo (v1)

Um `schedules.json` no formato anterior — sem `messages`, com `message` como
texto solto dentro de cada agendamento — continua sendo lido normalmente: o
processo converte para o formato acima em memória, criando uma mensagem
sintética na biblioteca para cada agendamento v1. Não existe comando de
migração porque não é necessário — a primeira gravação pela tela (ou qualquer
edição manual já no novo formato) persiste o arquivo em v2.

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
npm run dev                 # sobe o mock e a tela, já apontada para ele
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
src/ui/server.js     Servidor HTTP da tela (127.0.0.1)
src/ui/store.js      Leitura e escrita atômica do schedules.json
src/ui/routes/       Rotas de mensagens, agendamentos e ações
public/              A tela (HTML, CSS e JS vanilla)
data/                Seus agendamentos (fora do versionamento)
harness/             Mock do WAHA e validação por fase
```
