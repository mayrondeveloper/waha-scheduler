# Cliques por disparo — decisões de implementação

Data: 2026-09-12
Subprojeto C do roteiro aprovado em 2026-09-11 (item 7). Implementa a spec
`2026-09-11-cliques-por-disparo-spec.md` (R1 a R11), com as decisões abaixo
que ela deixou em aberto. Depende de A (`dispatchId` usa `newId`, `targets`)
e de B (spintax roda antes da troca de links).

## Decisões

- **C1. R11 (prévia customizada) é obrigatório**, conforme o resultado do
  spike: sem ela, o link rastreável aparece sem título nem imagem.
- **C2. O redirecionador vive neste repositório**, em `src/redirect/`, como
  processo separado (`npm run redirect`). Node 24 com `node:sqlite`
  (`DatabaseSync`), sem dependência. Escuta só em `127.0.0.1`
  (`REDIRECT_PORT`, padrão 3030) e é exposto por um túnel fixo da Cloudflare
  apontando para essa porta; a receita fica no README. A URL pública vai em
  `REDIRECT_PUBLIC_URL` (base dos links gerados) e, do lado do agendador, em
  `CLICKS_URL` e `CLICKS_API_KEY`.
- **C3. Contas desde o início**, como na spec: tabela `accounts` e o CLI
  `bin/redirect-account.js <nome>`, que cria a conta e imprime a chave uma
  única vez (guardada como SHA-256).
- **C4. Banco em `REDIRECT_DB`** (padrão `./data/clicks.sqlite`). Tabelas:
  `accounts`, `links`, `clicks`, `salts` (sal diário para o hash de
  visitante, persistido para a contagem de únicos sobreviver a reinício).
  Contadores `clicks_total` e `unique_total` em `links`, atualizados a cada
  clique humano, para os totais sobreviverem à retenção de 180 dias dos
  cliques brutos (limpeza no boot e a cada 24 h).
- **C5. Classificação do acesso** (R6): `HEAD` ou User-Agent com
  `WhatsApp`, `facebookexternalhit`, `bot`, `crawler`, `preview`, `curl`
  (sem distinção de maiúsculas) é `bot`; acesso do mesmo endereço que criou
  o link nos primeiros 60 s é `preview`; o resto é `human`. Só `human`
  conta. Limite de 60 acessos por minuto por endereço em `/r/`, em memória.
- **C6. Degradação sempre para o texto simples.** No agendador, a ordem por
  disparo é: gerar `dispatchId`; se cliques estão ligados, pedir os links
  (2 s de limite) e, falhando, seguir com os links originais e `tracking:
  "unavailable"`; buscar o Open Graph do primeiro link (5 s, 1 MB) com
  cache de 1 h por URL; por grupo: sortear o spintax, trocar os links,
  enviar por `link-custom-preview` quando há prévia e não há anexo, senão
  `sendText`/anexo como hoje. Se o `link-custom-preview` falhar, envia
  `sendText` uma vez e loga `preview: "failed"`. Nunca duas tentativas do
  mesmo endpoint.
- **C7. `dispatchId` em toda linha do log**, inclusive envios manuais e pelo
  terminal. O histórico agrupa por ele quando existe e cai na regra atual
  para linhas antigas.
- **C8. UTM por agendamento** (`utm: true` por padrão), caixa "Adicionar UTM
  ao link" no formulário.
- **C9. A tela nunca fala com o redirecionador**: `GET /api/clicks` no
  servidor local consulta com a chave e cacheia 60 s.

## Redirecionador

Rotas:

| Rota | Auth | Comportamento |
|---|---|---|
| `POST /api/links` | Bearer | Corpo da spec; cria um código base62 de 10 caracteres por (grupo, URL); devolve `{ links: { [groupId]: { [url]: shortUrl } } }`. Só `http(s)`. Corpo até 256 KB. |
| `GET /api/dispatches/:id/clicks` | Bearer | `{ clicks, unique, groups: { [groupId]: { clicks, unique } } }` da conta. |
| `GET /r/:code` | não | 302 para `final_url`, `Cache-Control: no-store`; registra o acesso depois de responder. 404 neutro se não existe. |
| `GET /robots.txt` | não | `Disallow: /r/`. |
| `GET /healthz` | não | `{ ok: true }`. |

UTM (R5): `utm_source=whatsapp`, `utm_medium=grupo`, `utm_campaign=<slug do
agendamento>`, `utm_content=<slug do grupo>`, sem sobrescrever parâmetros
existentes. Slug: minúsculas, sem acento, `-` no lugar do que não é
`[a-z0-9]`.

Hash de visitante: SHA-256 de `sal do dia + endereço + User-Agent`. O
endereço nunca é gravado em claro; `creator_ip_hash` idem.

Módulos: `src/redirect/db.js` (schema e consultas), `src/redirect/codes.js`
(base62, slug, UTM, classificação; funções puras), `src/redirect/server.js`
(HTTP). Testes com banco em arquivo temporário.

## Lado do agendador e da tela

- `src/links.js`: `findUrls(text)`, `rewriteLinks(text, map)` (puras) e
  `requestLinks(input, cfg)` com `AbortController` de 2 s.
- `src/preview.js`: `fetchOpenGraph(url, { timeoutMs, maxBytes, fetchImpl })`
  lê `og:title`, `og:description`, `og:image` por expressão regular no HTML
  (até 1 MB); devolve nulo sem `og:title`. Cache em memória por 1 h.
- `src/waha/client.js`: `sendTextWithPreview(chatId, text, preview, cfg)`
  → `POST /api/send/link-custom-preview` com `{ session, chatId, text,
  preview: { url, title, description, image: { url } } }`.
- `broadcast` recebe `links` (mapa por grupo), `preview`, `dispatchId`,
  `tracking` e grava tudo no log.
- `src/config.js`: `CLICKS_URL`, `CLICKS_API_KEY` (ambas vazias = cliques
  desligados).
- `GET /api/clicks?dispatch=a&dispatch=b` com cache de 60 s por id;
  `GET /api/status` ganha `clicks: "on" | "off"`.
- Tela: histórico com "47 cliques (31 únicos)" por disparo e por grupo,
  "não medido", "sem link", "cliques desligados"; card com os cliques do
  último disparo; caixa de UTM no formulário; atualização a cada 60 s com
  a aba de histórico aberta.

## Túnel

README: criar um túnel nomeado (`cloudflared tunnel create waha-clicks`),
rota de DNS para um hostname do domínio do usuário, `config.yml` apontando
`http://127.0.0.1:3030`, e `cloudflared tunnel run` como serviço. A
verificação deste subprojeto usa o túnel temporário (`trycloudflare.com`),
como no spike, e nunca envia mensagem real.

## Testes

- `codes.js`: base62, slug, UTM sem sobrescrever, classificação por UA e
  pela regra dos 60 s.
- `db.js`/`server.js`: criar links, redirecionar, contar humano/bot/preview,
  únicos por dia, conta errada recebe 401, código inexistente 404, corpo
  grande 413, retenção apaga cliques antigos e mantém totais.
- `links.js`: URLs no texto (com pontuação em volta, sem pegar a barra
  final errada), troca preservando formatação, tempo esgotado devolve
  indisponível.
- `preview.js`: OG extraído, sem `og:title` devolve nulo, HTML maior que o
  limite é cortado, cache.
- `broadcast`: envia com prévia; falha da prévia cai para texto; sem
  redirecionador manda o original com `tracking: "unavailable"`; `dispatchId`
  em todas as linhas.
- Tela: histórico com cliques por disparo e grupo; estados "não medido",
  "sem link" e "desligado"; agrupamento por `dispatchId`.
- Harness inalterado (o mock não tem os endpoints novos: o envio cai para
  `sendText`, que é o que ele confere).
