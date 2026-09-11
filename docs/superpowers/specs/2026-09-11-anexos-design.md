# Anexos nas mensagens — design

Data: 2026-09-11
Status: aprovado, em implementação

## Contexto

As mensagens são só texto. Para grupo de ofertas, oferta sem foto rende menos;
para comunidades, aviso costuma vir com PDF ou áudio. O WAHA em uso (2026.8.2,
Core) já envia mídia: desde a 2026.6.1, `sendImage`, `sendVideo`, `sendFile` e
`sendVoice` são gratuitos.

## Objetivo

Uma mensagem pode ter um anexo (imagem, vídeo, documento ou áudio), que sai
junto com o texto em cada grupo, no agendamento e no "Enviar agora".

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| A1 | Um anexo por mensagem | Um envio só por grupo, como no WhatsApp; cobre a oferta com foto |
| A2 | O texto vai como legenda quando cabe (1024 caracteres, limite do WhatsApp); senão, ou se for áudio, o anexo sai primeiro e o texto em seguida | Fiel ao que o usuário vê no WhatsApp; áudio não tem legenda |
| A3 | Arquivo em `data/media/<id>.<ext>`, ao lado do `schedules.json`; metadados dentro da mensagem | `data/` já fica fora do git; a mensagem continua uma entidade só |
| A4 | Upload em base64 dentro do próprio `POST`/`PUT` da mensagem | Atômico: cancelar não deixa arquivo órfão; o servidor continua só JSON |
| A5 | Envio ao WAHA em base64 (`file.data`), nunca por URL | O WAHA em Docker não enxerga uma URL da tela em `127.0.0.1` |
| A6 | Limite de 16 MB por anexo | Teto do WhatsApp para imagem, vídeo e áudio; documento maior fica para depois |
| A7 | GIF vai como arquivo | O WhatsApp trata GIF como vídeo e a engine WEBJS não converte |
| A8 | Áudio vai por `sendFile` com o tipo de áudio, não por `sendVoice` | Chega tocável no grupo sem depender de conversão para OPUS dentro do WAHA |
| A9 | O mock do harness não muda | É contrato; com anexo, o envio contra o mock falha com 404 e o histórico mostra |

## Tipos aceitos

| Tipo | Mimetypes | Endpoint do WAHA | Legenda |
|---|---|---|---|
| Imagem | `image/jpeg`, `image/png`, `image/webp` | `POST /api/sendImage` | sim |
| Vídeo | `video/mp4` | `POST /api/sendVideo` | sim |
| Documento | qualquer outro, inclusive `image/gif` e `application/pdf` | `POST /api/sendFile` | sim |
| Áudio | `audio/mpeg`, `audio/ogg`, `audio/mp4`, `audio/aac`, `audio/wav` | `POST /api/sendFile` | não |

Corpo enviado ao WAHA: `{ session, chatId, file: { mimetype, filename, data }, caption? }`.

## Formato de dados

Na mensagem, campo opcional `media`:

```json
{
  "id": "msg-a1b2c3",
  "name": "Oferta do dia",
  "text": "*Torto Arado* por R$ 39,90",
  "media": {
    "id": "med-9f8e7d6c",
    "filename": "torto-arado.jpg",
    "mimetype": "image/jpeg",
    "size": 183420,
    "kind": "image"
  }
}
```

- `id` gerado no servidor; o arquivo fica em `data/media/<id>.<ext>`, com a
  extensão derivada do nome original (só letras e números, até 8 caracteres;
  sem extensão válida, `bin`).
- `filename` é o nome original, usado no envio e na tela.
- `kind` é derivado do `mimetype` na gravação e decide o endpoint.
- `text` continua obrigatório.
- Arquivo v1 e v2 sem `media` continuam válidos.

## API

| Método | Rota | Mudança |
|---|---|---|
| POST | `/api/messages` | Aceita `media: { filename, mimetype, data }` (base64) |
| PUT | `/api/messages/:id` | `media: { filename, mimetype, data }` troca o anexo (apaga o antigo); `media: { id }` mantém o atual; `media` ausente ou `null` remove |
| DELETE | `/api/messages/:id` | Apaga o arquivo junto |
| GET | `/api/media/:id` | Serve o arquivo do anexo cujo `id` existe em alguma mensagem, com o `Content-Type` gravado e `Content-Disposition: inline`. 404 se não existe |

Regras:

- O corpo das rotas de mensagem pode ter até 24 MB (16 MB em base64 mais o
  JSON); as demais rotas continuam em 1 MB.
- Tipo fora da tabela responde 400 dizendo quais são aceitos; anexo maior que
  16 MB responde 400 com o tamanho; base64 inválido responde 400.
- Se a validação da mensagem falhar depois de o arquivo já ter sido gravado
  (nome duplicado, por exemplo), o arquivo é apagado.
- `GET /api/media/:id` nunca monta caminho a partir da URL: procura o id na
  biblioteca e abre o arquivo pelo caminho gravado.

## Envio

- `src/media.js` (novo): tipos aceitos, `classifyMedia`, `mediaDirFor`,
  `saveMedia`, `removeMedia`, `mediaPath`, `readMediaBase64`.
- `src/waha/client.js`: `sendMedia(chatId, file, options, cfg)` escolhe o
  endpoint pelo `kind` e envia `file.data` em base64.
- `src/broadcast.js`: `broadcast(text, groups, { media })`, com `media` =
  metadados mais `path`. Lê o arquivo uma vez, antes do laço; arquivo ausente
  interrompe o disparo antes de qualquer envio, com erro nomeando o anexo.
  Por grupo: legenda quando cabe; senão anexo e depois texto, sem intervalo
  entre os dois. O log ganha `media: { kind, filename }` (aditivo).
- `loadSchedules` devolve `media` junto do texto; `src/index.js` e
  `POST /api/schedules/:id/run` passam o anexo com o caminho.

## Tela

- Barra do editor ganha "Anexar" (clipe), que abre o seletor de arquivo com os
  tipos aceitos. Ao escolher: tipo e tamanho são validados na hora, com o erro
  junto do campo; o arquivo aparece numa tira abaixo do texto, com miniatura
  (imagem e vídeo) ou ícone, nome, tamanho e "Remover".
- Prévia do balão: imagem ou vídeo em cima da legenda; documento e áudio como
  cartão com ícone, nome e tamanho, como no WhatsApp.
- Lista de mensagens, seleção de mensagem no agendamento e modal de envio
  mostram o anexo.
- Ao salvar, o arquivo vai em base64 no corpo da mensagem. Abrir uma mensagem
  com anexo mostra o atual (servido por `GET /api/media/:id`); salvar sem mexer
  o mantém.
- Nada novo de cor. Ícones Lucide: `paperclip`, `image`, `film`, `music`,
  `fileText`.

## Casos de borda

| Situação | Comportamento |
|---|---|
| Arquivo do anexo apagado do disco | O disparo falha antes de enviar, com "Anexo não encontrado: <nome>"; a tela mostra a falha no histórico |
| Texto com mais de 1024 caracteres | Anexo sem legenda, depois o texto |
| Anexo enviado e texto falhou (caso A2 em duas mensagens) | Linha de log com erro dizendo que o anexo foi e o texto não |
| Tipo não aceito | 400 na API e erro na tela antes do upload |
| Maior que 16 MB | 400 na API e erro na tela antes do upload |
| Editar só o nome de uma mensagem com anexo | O anexo é mantido (`media: { id }`) |
| Mock do harness | `sendImage`/`sendFile` não existem no mock: envio com anexo falha com 404 |
| Vídeo ou áudio que a engine WEBJS não consegue processar | O erro do WAHA chega ao histórico |

## Testes

1. `src/media.js`: classificação por mimetype, extensão segura, gravação e
   remoção, limite de tamanho, base64 inválido.
2. `validateMessage` com `media` válido, inválido e ausente; `loadSchedules`
   devolve `media`.
3. `broadcast` com client falso: legenda quando cabe, anexo e texto separados
   quando não cabe e para áudio, arquivo ausente interrompe antes de enviar,
   log com `media`.
4. `sendMedia`: endpoint por tipo e corpo enviado (com `fetch` falso).
5. API: criar com anexo, manter, trocar (arquivo antigo some), remover,
   excluir mensagem apaga o arquivo, 400 por tipo e tamanho, `GET /api/media`
   serve e recusa id inexistente; corpo de 2 MB aceito em `/api/messages` e
   recusado em outra rota.
6. Tela: editor com o botão e a tira, prévias por tipo, payload do salvar com
   `data` base64 e com `{ id }` na edição sem mexer.
7. Navegador, contra o mock: anexar imagem, prévia, salvar, reabrir, lista,
   envio com anexo mostrando a falha do mock no histórico.

Nenhuma mensagem real é enviada.

## Fora de escopo

Vários anexos por mensagem; mensagem de voz (OPUS); documentos acima de 16 MB;
compressão de imagem na tela; anexo por URL; álbuns.
