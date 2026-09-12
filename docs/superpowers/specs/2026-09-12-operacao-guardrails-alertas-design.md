# Ajustes, janela de silêncio, limite por hora, spintax, alertas e pausa geral — design

Data: 2026-09-12
Subprojeto B do roteiro aprovado em 2026-09-11 (itens 4 a 6). Depende do
subprojeto A (envio único, `src/store.js`, tique do agendador).

## Problema

O maior medo de quem administra grupo é perder o número. O WhatsApp pune
exatamente o padrão que um agendador produz: a mesma mensagem, para muitos
grupos, em sequência, de madrugada. E quando algo dá errado (o número cai,
um disparo falha), só quem está olhando a tela fica sabendo.

## Decisões

- **B1. Ajustes ficam no arquivo de agendamentos**, em `settings`, e não no
  `.env`: são escolhas do dono do grupo, mudam pela tela e valem sem
  reiniciar, porque o agendador já recarrega o arquivo. O `.env` continua
  com o que é infraestrutura (WAHA, portas, caminhos).
- **B2. Pausa geral é um interruptor em `settings.paused`.** Pausado, o
  agendador não dispara nada pelo cron e registra no histórico cada disparo
  pulado. Envios únicos ficam segurados: o tique não os avalia enquanto
  pausado; ao retomar, os vencidos há mais de 10 minutos viram perdidos.
  O envio manual continua permitido (é um gesto explícito), com aviso no
  modal.
- **B3. Janela de silêncio adia, não descarta.** Um disparo (cron ou único)
  que cai dentro da janela vira `pending { at: <fim da janela>, reason:
  "quiet", from: <instante original> }` gravado no agendamento; o tique
  dispara no fim da janela e limpa `pending`. Um cron que dispara de novo
  enquanto já existe um `pending` do mesmo agendamento não empilha: fica o
  primeiro. A janela pode virar a meia-noite (22:00 a 08:00). O envio
  manual sai na hora, com aviso no modal.
- **B4. Limite por hora é um freio, não uma fila.** Antes de cada grupo, o
  envio conta no log de envios quantas linhas `sent` há na última hora
  (agendador e tela compartilham o arquivo, então a conta vale para os
  dois) e, no limite, espera até a mais antiga sair da janela. A linha do
  log registra `waitedMs`. `hourlyLimit: 0` desliga. Padrão 50.
- **B5. Spintax no texto.** `{Bom dia|Olá|Oi}` com aninhamento; cada grupo
  recebe uma combinação sorteada; o log guarda o texto que saiu. Chave sem
  par é texto literal. O módulo vive em `public/spintax.js` e o servidor o
  importa dali: um código só, sem DOM.
- **B6. Alertas nunca atrasam nem derrubam um envio.** Enviar alerta é
  disparar e esquecer, com erro apenas logado. Canais: WhatsApp para o
  número da própria sessão (`me.id`, sem configurar nada) e um POST numa
  URL de push (`settings.alerts.pushUrl`, pensado para ntfy.sh: corpo em
  texto, cabeçalho `Title`). Queda do número só vai pela URL, porque o
  WhatsApp não consegue avisar de si mesmo.
- **B7. O agendador vigia a sessão do WAHA a cada 60 s** e grava o resultado
  no arquivo de status (`waha: { status, me, checkedAt }`). A tela passa a
  saber do WAHA pelo agendador também, e a aba Ajustes mostra para onde os
  alertas vão.

## Formato

```json
{
  "settings": {
    "paused": false,
    "quietHours": { "start": "22:00", "end": "08:00" },
    "hourlyLimit": 50,
    "alerts": { "whatsapp": true, "pushUrl": "https://ntfy.sh/meu-topico" }
  }
}
```

`normalizeStore` preenche os padrões quando `settings` falta: `paused:
false`, `quietHours: null`, `hourlyLimit: 50`, `alerts: { whatsapp: true,
pushUrl: "" }`. Validação: horários `HH:mm`; `hourlyLimit` inteiro de 0 a
1000; `pushUrl` vazia ou `http(s)`.

Agendamento ganha `pending: { at, reason, from } | null`.

Linhas do log ganham campos opcionais: `status: "skipped"` com `reason:
"paused"`, `deferredFrom` (ISO do horário original), `waitedMs`.

## Agendador

- Ao disparar pelo cron: se `settings.paused`, grava uma linha `skipped`
  por grupo e sai. Senão, se agora está na janela, grava `pending` e sai.
  Senão, envia.
- O tique (de A) passa a tratar também `pending` de qualquer agendamento:
  vencido, dispara com `deferredFrom` e limpa. Envio único vencido dentro da
  janela vira `pending` para o fim dela, sem contar como perdido.
- Funções puras em `src/quiet.js`: `inQuietHours(now, quiet, tz)` e
  `quietEnd(now, quiet, tz)`, com `Intl` para a hora de parede no fuso.
- Vigia da sessão (`SESSION_POLL_MS = 60_000`): `client.getSession(cfg)`
  chama `GET /api/sessions/{session}` e devolve `{ status, me }`. Transição
  de `WORKING` para outro estado dispara alerta "número caiu" (só push);
  volta a `WORKING` dispara "número reconectado" (WhatsApp e push). Disparo
  com falhas dispara "Agendamento X: 2 de 5 grupos falharam: <primeiro
  erro>" (WhatsApp e push). Envio único perdido dispara "Envio único
  perdido" (WhatsApp e push).
- `src/alerts.js`: `sendAlert({ title, text, channels }, { settings, cfg,
  client, me, fetchImpl })`. `channels` é subconjunto de `["whatsapp",
  "push"]`; `whatsapp` exige `settings.alerts.whatsapp` e `me`; `push` exige
  `pushUrl`. Erros vão para o log do agendador com contexto.

## Envio (`broadcast`)

Recebe `settings` (ou os campos que usa) nas opções: `hourlyLimit` e
`logPath` para o freio; o texto passa por `spin` por grupo antes de
enviar. A ordem por grupo: sortear o texto, esperar pelo freio, enviar,
logar (`message` é o texto sorteado, `waitedMs` quando esperou).

`countRecentSends(logPath, sinceMs)` lê o arquivo do fim para o começo
(arquivo pequeno; leitura inteira é aceitável) e conta `sent` com `ts` na
janela. Sem arquivo: zero.

## API da tela

| Rota | Comportamento |
|---|---|
| `GET /api/settings` | Devolve `settings` com padrões preenchidos. |
| `PUT /api/settings` | Objeto completo, validado; 400 com o campo errado. |
| `GET /api/status` | Ganha `paused`, `quietHours` (para a faixa e os avisos) e `waha` do arquivo de status. |
| `GET /api/session` | Proxy de `getSession`: `{ status, me: { id, pushName } }`; 502 se o WAHA não responde. Usado pela aba Ajustes. |

## Tela

- **Aba "Ajustes":** formulário com Janela de silêncio (ligar, início,
  fim), Limite por hora (número, "0 desliga"), Alertas (WhatsApp para
  "<pushName> · <número>", URL de push com o exemplo do ntfy.sh e um botão
  "Enviar teste" que chama `POST /api/alerts/test`), e o interruptor
  "Pausar todos os envios". Salvar grava tudo de uma vez.
- **Faixa de status:** pausado vira item vermelho "Envios pausados" com o
  botão "Retomar" ao lado. Dentro da janela de silêncio, item neutro "Janela
  de silêncio até 08:00".
- **Formulário de agendamento:** ao escolher um horário dentro da janela, a
  prévia avisa "dentro da janela de silêncio: vai sair às 08:00".
- **Modal de envio manual:** avisos "Envios pausados: este envio manual sai
  mesmo assim" e "Dentro da janela de silêncio: sai agora mesmo assim".
- **Editor de mensagem:** a prévia mostra a primeira variação e "8
  combinações" quando há spintax; sem spintax, nada muda.
- **Histórico:** disparo pulado aparece como "Pulado: envios pausados";
  adiado, com "adiado pela janela de silêncio (era 23:00)"; linha de grupo
  com "esperou 4 min pelo limite por hora".

## Testes

- `spintax.js`: sem chaves, uma escolha, aninhado, chave sem par, contagem.
- `quiet.js`: dentro/fora, janela que vira a meia-noite, fim da janela no
  dia seguinte, fuso.
- `alerts.js`: canais por configuração, erro não propaga, corpo do push.
- `broadcast`: freio espera quando no limite e não espera abaixo; texto
  sorteado por grupo no log; `waitedMs`.
- Agendador: pausado pula e loga; janela adia e o tique dispara no fim;
  pending não empilha; vigia da sessão dispara alertas nas transições e
  grava `waha` no status.
- API: settings (validação), session, alerts/test.
- Tela: aba Ajustes monta e salva; faixa pausada com Retomar; avisos do
  modal; prévia com combinações; histórico com pulado e adiado.
- Harness inalterado e verde.

## Fora de escopo

- Limite por dia ou por grupo.
- Alerta por e-mail.
- Embaralhar a ordem dos grupos (o intervalo aleatório já existe).
