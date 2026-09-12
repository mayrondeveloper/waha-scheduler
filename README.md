# waha-scheduler

Agendador de mensagens para grupos de WhatsApp via [WAHA](https://waha.devlike.pro/).
Lê os agendamentos de um `schedules.json`, dispara nos horários definidos por cron
e registra cada tentativa de envio em um log JSONL.

## Requisitos

- Node.js 18+ (usa `fetch` nativo e ES Modules); o redirecionador de cliques
  exige Node.js 24 (`node:sqlite`)
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
| `CLICKS_URL` | vazio | URL pública do redirecionador de cliques; vazia desliga a medição |
| `CLICKS_API_KEY` | vazio | Chave da conta no redirecionador (`bin/redirect-account.js`) |
| `REDIRECT_PORT` | `3030` | Porta do redirecionador (`npm run redirect`), sempre em `127.0.0.1` |
| `REDIRECT_DB` | `./data/clicks.sqlite` | Banco do redirecionador |
| `REDIRECT_PUBLIC_URL` | `http://127.0.0.1:<porta>` | URL pública com que os links curtos são montados |

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

Em vez de cron, o formulário pede os dias da semana e o horário, e monta o
cron sozinho (Seg, Qua e Sex às 09:00 viram `0 9 * * 1,3,5`). Um cron editado
à mão que não cabe nesse formato aparece cru no formulário e é mantido como
está ao salvar.

O bloco "Quando" também aceita **Uma vez**: uma data e um horário para um
envio único, no fuso de `TIMEZONE`. O agendador confere os envios únicos a
cada 30 segundos; depois de sair, o card mostra "Enviado" com a hora. Se o
agendador estava parado no horário, ele ainda envia até 10 minutos de atraso;
além disso, marca "Perdido" e explica o motivo (o "Enviar agora" continua
disponível). Mudar a data de um envio já feito o reativa.

A aba **Grupos** guarda listas de grupos ("Ofertas SP", "Todos os de
livros"): um agendamento escolhe listas, grupos avulsos ou os dois, e o
destino é a união. Mudar a lista muda os próximos envios de quem a usa; uma
lista em uso não pode ser excluída. **Duplicar**, no menu do card e na linha
da mensagem, abre o editor preenchido com "(cópia)" no nome.

A aba **Ajustes** guarda o que protege o número e avisa o dono:

- **Pausar todos os envios**: nenhum agendamento dispara; o histórico registra
  cada disparo pulado; envios únicos esperam a retomada (os que passarem de 10
  minutos ficam como perdidos). A faixa do topo fica vermelha, com "Retomar".
  O "Enviar agora" continua funcionando, com aviso no modal.
- **Janela de silêncio** (ex.: 22:00 a 08:00, pode virar a meia-noite): um
  disparo que cair nela é adiado para o fim da janela, o adiamento fica gravado
  no arquivo (sobrevive a reinício) e o histórico marca "adiado". O formulário
  avisa quando o horário escolhido cai na janela.
- **Limite por hora** (padrão 50, 0 desliga): antes de cada grupo, o envio
  conta o que saiu na última hora, pelo agendador e pela tela, e no limite
  espera a vez em vez de perder o envio. O histórico diz quanto esperou.
- **Alertas**: falhas num disparo, envio único perdido e a volta do número vão
  para o WhatsApp do próprio número da sessão; a queda do número vai por um
  POST em texto numa URL de push (o [ntfy.sh](https://ntfy.sh) dá push no
  celular sem conta: crie um tópico e cole a URL). "Enviar teste" confere os
  dois canais. O agendador consulta a sessão do WAHA a cada 60 segundos.

As mensagens aceitam **spintax**: `{Bom dia|Olá|Oi}, grupo!` sorteia uma
alternativa por grupo (pode aninhar), para a mesma mensagem não sair idêntica
em todos. A prévia mostra a primeira variação e conta as combinações; o
histórico guarda o texto que saiu em cada grupo. Chave sem par é texto comum.

### Cliques por disparo

Com o redirecionador ligado, cada link da mensagem vira um link curto único por
(disparo, grupo) antes de sair, e o histórico passa a mostrar "47 cliques (31
únicos)" por disparo e, aberto, por grupo; o card mostra os cliques do último
envio. Só cliques humanos contam: robôs, buscadores de prévia e o próprio
remetente nos primeiros 60 segundos ficam de fora; "único" é por visitante e
por dia (hash com sal diário, nenhum endereço guardado em claro). O destino
recebe `utm_source=whatsapp`, `utm_medium=grupo`, `utm_campaign=<agendamento>`
e `utm_content=<grupo>`, sem sobrescrever parâmetros que o link já tinha; a
caixa "Adicionar UTM ao link" desliga isso por agendamento.

O link sai com **prévia do destino** (título, descrição e imagem das tags
Open Graph, buscadas na hora do disparo) pelo `link-custom-preview` do WAHA.
O envio nunca depende disso: sem redirecionador (mais de 2 segundos sem
resposta) a mensagem sai com os links originais e o histórico marca "não
medido"; sem prévia, sai como texto simples.

O redirecionador é um processo separado, com contas por chave, e precisa ser
público (é ele que o celular de quem clica acessa). Para rodar no próprio Mac:

```bash
npm run redirect                                  # escuta em 127.0.0.1:3030
node bin/redirect-account.js "Compara Livros"     # cria a conta e imprime a chave
```

Cole `CLICKS_URL` (a URL pública) e `CLICKS_API_KEY` no `.env` do agendador e
da tela, e aponte `REDIRECT_PUBLIC_URL` para a mesma URL pública. Para expor a
porta com um hostname fixo e HTTPS, um túnel nomeado da Cloudflare resolve sem
abrir porta no roteador:

```bash
cloudflared tunnel login
cloudflared tunnel create waha-clicks
cloudflared tunnel route dns waha-clicks go.seudominio.com.br
```

Em `~/.cloudflared/config.yml`:

```yaml
tunnel: waha-clicks
credentials-file: /Users/voce/.cloudflared/<id-do-tunel>.json
ingress:
  - hostname: go.seudominio.com.br
    service: http://127.0.0.1:3030
  - service: http_status:404
```

E `cloudflared tunnel run waha-clicks` (ou `cloudflared service install` para
subir com o sistema). O redirecionador guarda os cliques brutos por 180 dias e
os totais para sempre, em `REDIRECT_DB`.

No topo, uma faixa mostra se o agendador (`npm start`) está rodando, se o
WAHA respondeu e qual é o próximo envio. É ela que avisa quando um agendamento
não vai sair porque o agendador está parado. O agendador grava um sinal de vida
a cada 15 segundos em `scheduler-status.json`, na mesma pasta do arquivo de
agendamentos; sem sinal há mais de 45 segundos, a tela mostra que ele parou de
responder. Todas as datas da tela seguem o fuso de `TIMEZONE`.

As mensagens aceitam a formatação do WhatsApp (`*negrito*`, `_itálico_`,
`~tachado~`, `` `código` ``, bloco entre três crases, listas com `-` ou `1.` e
citação com `>`) e emojis, pela barra do editor. O texto é guardado e enviado
cru, com os marcadores; a prévia ao lado mostra como ele chega no grupo. Um
agendamento novo pode ter a mensagem escrita ali mesmo, em "Escrever nova".

Cada mensagem pode levar **um anexo**: imagem (JPEG, PNG ou WebP), vídeo MP4,
áudio ou qualquer outro arquivo (PDF, planilha, GIF...), até 16 MB. O clipe na
barra do editor abre o seletor; o anexo aparece numa tira abaixo do texto e na
prévia do balão, e sai da mensagem pelo "Remover". No envio, o texto vai como
legenda do anexo (imagem, vídeo e arquivo aceitam legenda de até 1024
caracteres); quando não cabe, ou quando o anexo é áudio, o anexo sai primeiro
e o texto logo em seguida. O arquivo fica em `data/media/`, ao lado do arquivo
de agendamentos, e é apagado quando a mensagem perde o anexo ou é excluída.

A aparência segue o design system do projeto, em
`docs/design/waha-scheduler-design-system.html` (um arquivo só, abre direto no
navegador): tema escuro, sem variante clara; fontes Geist e Geist Mono
embutidas em `public/fonts/` (subconjunto latino, licença SIL OFL, nada é
carregado da internet); verde dessaturado reservado para estado. Cada card de
agendamento traz o badge de estado (Ativo, Pausado ou Falha no envio, este
último a partir do último disparo daquele agendamento no histórico), os nomes
dos grupos e, quando houve falha, o motivo e o horário.

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

O botão "Enviar agora" envia mensagem de verdade quando há um WAHA real
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
  "settings": {
    "paused": false,
    "quietHours": { "start": "22:00", "end": "08:00" },
    "hourlyLimit": 50,
    "alerts": { "whatsapp": true, "pushUrl": "https://ntfy.sh/meu-topico" }
  },
  "groupLists": [
    { "id": "lst-3a9f1c2e", "name": "Ofertas SP", "groups": ["123456789@g.us", "987654321@g.us"] }
  ],
  "messages": [
    {
      "id": "msg-a1b2c3d4",
      "name": "bom-dia",
      "text": "Bom dia! Segue o resumo da semana.",
      "media": {
        "id": "med-9f8e7d6c",
        "filename": "capa.png",
        "mimetype": "image/png",
        "size": 48213,
        "kind": "image"
      }
    }
  ],
  "schedules": [
    {
      "id": "sch-e5f6a7b8",
      "name": "bom-dia-segunda",
      "cron": "0 9 * * 1",
      "messageId": "msg-a1b2c3d4",
      "groups": ["123456789@g.us"],
      "groupLists": ["lst-3a9f1c2e"],
      "enabled": true
    },
    {
      "id": "sch-9c8d7e6f",
      "name": "promo-de-sabado",
      "at": "2026-09-19T10:00",
      "messageId": "msg-a1b2c3d4",
      "groupLists": ["lst-3a9f1c2e"],
      "enabled": true
    }
  ]
}
```

- `messages` — biblioteca de mensagens reutilizáveis; cada uma tem `id`
  (gerado automaticamente quando ausente), `name`, `text` e, opcionalmente,
  `media`: o anexo, com `id`, `filename`, `mimetype`, `size` (bytes) e `kind`
  (`image`, `video`, `audio` ou `document`). O arquivo em si fica em
  `data/media/<id>.<extensão>`; a tela grava e apaga esse arquivo junto com a
  mensagem. Um anexo referenciado sem arquivo faz o envio daquela mensagem
  falhar com erro apontando o caminho esperado.
- `id` — gerado no servidor quando ausente; identifica agendamento ou mensagem
  de forma estável entre gravações.
- `name` — obrigatório e único (entre agendamentos, e separadamente entre
  mensagens); identifica o agendamento nos logs.
- `settings` — os ajustes da tela; ausente vale os padrões (`paused: false`,
  sem `quietHours`, `hourlyLimit: 50`, alerta no WhatsApp ligado e `pushUrl`
  vazia). O agendador aplica mudanças sem reiniciar.
- `groupLists` (na raiz) — listas de grupos reutilizáveis; cada uma tem `id`
  (gerado quando ausente), `name` único e `groups` com ao menos um id.
- `pending` (no agendamento) — gravado pelo agendador quando um disparo cai na
  janela de silêncio: `{ at, from, reason }`; some quando o envio sai.
- `cron` ou `at` — exatamente um dos dois. `cron` é validado na inicialização;
  um cron inválido aborta o processo apontando o agendamento problemático.
  `at` é um envio único, hora de parede no fuso `TIMEZONE`, no formato
  `AAAA-MM-DDTHH:MM`. O agendador grava `firedAt` quando o envio único sai e
  `missedAt` quando o horário passou há mais de 10 minutos sem ele rodar; a
  tela limpa os dois ao trocar a data.
- `messageId` — obrigatório; precisa apontar para um `id` existente em
  `messages`.
- `groupLists` (no agendamento) — opcional; ids de listas. O destino é a união
  dos `groups` com os grupos das listas, sem repetição. Com uma lista, `groups`
  pode ser `[]`.
- `groups` — opcional; quando **ausente**, herda `defaultGroups`. Informado como
  **lista vazia** é erro — desmarcar todos os grupos na tela não vira "herda os
  defaults", e sim uma recusa explícita.
- `enabled` — opcional (default `true`); agendamentos desabilitados são
  ignorados pelo cron (mas continuam disparáveis na hora, pela tela).
- `utm` — opcional (default `true`); `false` manda o link rastreável sem os
  parâmetros UTM no destino. Só importa com os cliques ligados.

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

`status` é `sent`, `error` ou `skipped` (disparo pulado com os envios
pausados, com `reason`); entradas com erro trazem o campo `error` com o
contexto da falha. Quando a mensagem tem anexo, a linha traz também `media`
com `kind` e `filename`. Um disparo adiado pela janela de silêncio traz
`deferredFrom` (o horário original) e um envio que esperou pelo limite por
hora traz `waitedMs`. Com spintax, `message` é o texto que saiu naquele grupo.
Toda linha traz `dispatchId` (o mesmo em todos os grupos de um disparo),
`tracking` (`none` sem link, `off` com cliques desligados, `ok` medido,
`unavailable` quando o redirecionador não respondeu) e `links` (quantas URLs
o texto tinha); com prévia do destino, `preview` é `sent` ou `failed`.

## Desenvolvimento

Nenhum teste toca a API real do WhatsApp — tudo passa pelo mock do harness.

```bash
npm test                    # testes unitários (node:test)
npm run harness             # valida todas as fases contra o mock
node harness/run.js phase1  # valida uma fase específica
npm run mock                # sobe só o mock do WAHA em :3999
npm run dev                 # sobe o mock e a tela, já apontada para ele
```

O mock só responde `sendText`: uma mensagem com anexo enviada contra ele falha
com `Erro 404 ao enviar anexo para ...` e aparece assim no histórico. Isso é o
esperado — o envio de mídia só existe contra um WAHA de verdade.

## Estrutura

```
bin/list-groups.js   CLI: lista grupos com ids normalizados
bin/send-now.js      CLI: disparo imediato
bin/redirect-account.js  CLI: cria uma conta no redirecionador
src/config.js        Variáveis de ambiente e defaults
src/logger.js        Saída de console e log JSONL de envios
src/waha/client.js   Cliente HTTP do WAHA (único ponto de rede com o WAHA)
src/broadcast.js     Envio para vários grupos, resiliente a falhas
src/dispatch.js      Identidade do disparo, links rastreáveis e prévia
src/links.js         URLs do texto, troca por links curtos, cliente do redirecionador
src/preview.js       Open Graph do destino (prévia do link)
src/schedules.js     Leitura e validação do schedules.json
src/store.js         Leitura e escrita atômica do schedules.json
src/index.js         Processo do agendador
src/scheduler-status.js  Status do agendador, lido pela tela
src/quiet.js         Janela de silêncio
src/alerts.js        Alertas ao dono (WhatsApp e URL de push)
src/redirect/        Redirecionador de cliques (processo separado, Node 24)
src/ui/server.js     Servidor HTTP da tela (127.0.0.1)
src/ui/routes/       Rotas de mensagens, agendamentos, listas, ajustes, ações e status
public/              A tela (HTML, CSS e módulos JS nativos, sem build)
data/                Seus agendamentos (fora do versionamento)
harness/             Mock do WAHA e validação por fase
```
