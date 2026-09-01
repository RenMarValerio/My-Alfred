# Bot de triagem "Karen" (WhatsApp) — M2 Distribuição

## Contexto

A M2 Distribuição passou a captar leads via anúncios em Instagram/Facebook, que caem no WhatsApp do escritório. Hoje a triagem inicial é manual; o objetivo é substituí-la por um bot determinístico (sem IA/LLM), "Karen", que faz duas perguntas de qualificação por menu numerado, roteia o lead por uma tabela (segmento × volume) e transfere a conversa ao vendedor correspondente — sem nenhuma regra de negócio hardcoded (textos e roteamento vêm do banco).

Levantamento do repositório `My-Alfred`: estava praticamente vazio (projeto greenfield). Continha apenas `README.md` (descrevia um bot Python de lembretes de Trello, sem relação com este projeto), `LICENSE`, e um `.gitignore` que por engano tinha colado dentro um script Python solto com uma credencial Twilio em texto puro (sandbox de teste, não produção). O usuário confirmou: apagar esse conteúdo anterior e seguir com o Karen do zero. Não existe "Sistema de Cotação" nem qualquer integração de WhatsApp real neste repositório — o provedor definitivo ainda não foi escolhido (ver "Itens em aberto").

## Decisões já confirmadas com o usuário

- **Provedor de WhatsApp real**: ainda não definido. Seguimos com a camada de integração isolada atrás de uma interface (`GatewayWhatsapp`), com apenas um esqueleto/stub para o provedor real — nada específico de Twilio/Meta é implementado nesta rodada.
- **Infra de deploy**: ainda não decidida. Assumimos processo Node de longa duração (VPS ou PaaS tipo Railway/Render/Fly.io) rodando o worker do poller continuamente. Se depois for serverless, o poller vira um cron externo chamando um endpoint — não muda o núcleo do domínio.
- **Mensagem sem texto (áudio/figurinha/imagem sem legenda)**: tratada como resposta inválida, conta como uma das 2 tentativas por pergunta.
- **Timers de lembrete (15min) e abandono (24h)**: correm 24/7, sem pausa por horário comercial.
- **Pergunta de nome antes da transferência**: depois que o volume é respondido com sucesso, o bot pergunta "Qual é o seu nome?" antes de rotear/transferir. O nome informado é gravado (campo próprio, distinto do nome de perfil do WhatsApp) e usado em dois lugares: (1) na mensagem de despedida ao cliente ("Perfeito, {{nome}}! Já estou te transferindo..."), e (2) no resumo enviado ao vendedor, junto com telefone e as demais respostas. Essa pergunta só entra no caminho de transferência **por qualificação completa** (segmento + volume respondidos); no caminho de **falha por 2 respostas inválidas** (em qualquer pergunta), a transferência ao vendedor padrão continua imediata, sem perguntar o nome — meu entendimento é que nesse caso já é uma triagem malsucedida e não vale insistir com mais uma pergunta; me avise se preferir perguntar o nome também nesse caminho.
- **Limpeza do repositório**: apagar o conteúdo atual do `.gitignore` (script Python + credencial exposta) e reescrever com regras reais de Node/TS; atualizar o `README.md` para descrever o projeto Karen. Isso remove o conteúdo do arquivo de trabalho, mas **não apaga a credencial do histórico do git** (o repositório é público) — recomendo, à parte e com sua confirmação, revogar a credencial Twilio no console deles e, se quiser, reescrever o histórico depois; nenhuma dessas duas ações entra neste plano sem autorização explícita separada.

## Arquitetura (hexagonal — ports & adapters)

Princípio: o domínio (máquina de estados) não importa nada de infraestrutura. Toda dependência externa (banco, WhatsApp, relógio) entra por uma porta (interface) e é implementada por um adapter — é o que permite trocar "transporte simulado" por "WhatsApp real" sem tocar o motor de regras.

```
src/
├── domain/triagem/          # tipos, normalização de resposta, processarEvento() — função pura, sem I/O
├── aplicacao/
│   ├── portas/               # GatewayWhatsapp, RepositorioLeads, RepositorioConfiguracao, RepositorioVendedores, Relogio
│   ├── processar-mensagem-recebida.ts
│   └── executar-poller-timeouts.ts
├── infraestrutura/
│   ├── persistencia/prisma/  # implementações concretas das portas de repositório
│   ├── whatsapp/
│   │   ├── gateway-simulado.ts     # implementação em memória/stdin — usada em testes e REPL
│   │   └── gateway-real/           # stubs a preencher quando o provedor for escolhido
│   ├── relogio/               # RelogioSistema (produção) e RelogioControlavel (testes)
│   └── scheduler/poller-timeouts.ts
├── interface/                 # cli-repl.ts (simulação), worker.ts (roda o poller), servidor-webhook.ts (placeholder)
└── config/variaveis-ambiente.ts

prisma/schema.prisma, prisma/migrations/
scripts/seed-*.ts
test/integracao/*.test.ts
docker-compose.yml            # Postgres local
```

Regra de dependência: `domain` não depende de nada do projeto; `aplicacao` depende de `domain` + das próprias portas; `infraestrutura` implementa as portas; `interface` compõe tudo (injeção manual, sem framework de DI).

## Ferramentas

- **ORM/migrations: Prisma.** Preferido a Knex (só query builder, sem tipos gerados) e a Drizzle (mais leve, mas `drizzle-kit` menos maduro que `prisma migrate` para uma equipe pequena entregando em etapas).
- **Banco: PostgreSQL** (não SQLite), inclusive em dev (via `docker-compose`), para paridade de ambiente. Motivo central: o ambiente de deploy final ainda não está decidido e pode não garantir disco persistente — um arquivo SQLite se perderia num redeploy sem volume, o que é inaceitável para o requisito de "estado sobrevive a restart". Postgres gerenciado também dá índice parcial (necessário para "um único lead ativo por telefone") e melhor concorrência entre o webhook e o poller escrevendo ao mesmo tempo.
- **Testes: Vitest.**
- **Relógio como porta explícita** (`Relogio.agora(): Date`), não `setTimeout`/`vi.useFakeTimers()`: a única fonte de verdade de um timeout pendente é a coluna `proximoTimeoutEm` no banco, comparada pelo poller contra "agora". Em teste, `RelogioControlavel.avancar(minutos)` avança um relógio mutável e chama `executarPoller(relogio.agora())` diretamente — determinístico, sem esperar tempo real, e testa a mesma função que roda em produção.

## Schema do banco (visão Prisma, documentação — não é código final)

```
OpcaoSegmento(id, ordem único, codigo único, rotulo, permiteTextoLivre, ativo)
OpcaoVolume(id, ordem único, codigo único, rotulo, ativo)
Vendedor(id, nome, telefoneWhatsapp único, ativo)
Roteamento(id, segmentoId→OpcaoSegmento, volumeId→OpcaoVolume, vendedorId→Vendedor, @@unique([segmentoId, volumeId]))
ConfiguracaoGeral(id fixo=1 singleton, vendedorPadraoId→Vendedor, timeoutLembreteMin=15, timeoutAbandonoH=24)
TextoMensagem(chave PK, conteudo, descricao?)   # boas_vindas, pergunta_segmento_cabecalho, pergunta_segmento_livre,
                                                  # pergunta_volume_cabecalho, pergunta_nome, nao_entendi, lembrete,
                                                  # transferencia_lead (placeholders {{nome}}, {{vendedor}}),
                                                  # notificacao_vendedor (placeholders {{nome}}, {{telefone}},
                                                  # {{segmento}}, {{volume}}, {{origem}}, {{data_hora}})
Lead(id, telefone [indexado, não único — múltiplos ciclos], nomeWhatsapp?, nomeContato?, origem?,
     estado[EM_TRIAGEM|TRANSFERIDO|ABANDONADO], etapaAtual[AGUARDANDO_SEGMENTO|_SEGMENTO_LIVRE|_VOLUME|_NOME]?,
     segmentoId?, segmentoLivre?, volumeId?, vendedorId?,
     tentativasInvalidas=0, proximoTimeoutEm?, proximoTimeoutTipo[LEMBRETE|ABANDONO]?,
     leadAnteriorId? [rastreia ciclo anterior do mesmo telefone],
     criadoEm, atualizadoEm, transferidoEm?, abandonadoEm?,
     @@index([telefone]), @@index([estado, proximoTimeoutEm]),
     índice único PARCIAL (migration SQL manual): no máx. 1 lead com estado=EM_TRIAGEM por telefone)
Mensagem(id, leadId→Lead, direcao[ENTRADA|SAIDA], telefoneRemetente, telefoneDestinatario, texto, tipo?, criadoEm,
         @@index([leadId, criadoEm]))
ClienteExistente(telefone PK, origemImport?, criadoEm)   # allowlist que nunca recebe automação
```

Decisões de modelagem:
- **`nomeWhatsapp` vs `nomeContato`**: `nomeWhatsapp` é o nome de perfil que o provedor de WhatsApp informa automaticamente (quando disponível); `nomeContato` é o nome que a Karen pergunta explicitamente antes de transferir. São campos distintos — o segundo nunca é inferido do primeiro.
- **Histórico de mensagens em tabela própria (`Mensagem`), não JSON**: evita reler/regravar uma coluna JSON crescente a cada mensagem (risco de corrida), permite índice e consultas para dashboard futuro.
- **Novo ciclo após "abandonado" = nova linha em `Lead`** (mesmo telefone, novo id, `leadAnteriorId` aponta pro ciclo anterior): preserva histórico completo para reengajamento/dashboard e mantém o índice único parcial de "um lead ativo por telefone" sem conflito com ciclos passados.
- **Menu numerado renderizado em runtime** a partir de `OpcaoSegmento`/`OpcaoVolume` ativas (ordenadas por `ordem`) — é isso que garante zero hardcode: mudar uma opção no banco muda texto exibido e validação ao mesmo tempo.

## Máquina de estados — tabela de transição

Estado = `estado` + `etapaAtual` da linha de `Lead`.

| Estado atual | Evento / condição | Ações | Novo estado |
|---|---|---|---|
| Sem lead ativo, ou lead mais recente `TRANSFERIDO`, ou telefone em `ClienteExistente` | Mensagem recebida | Nenhuma ação — bot nunca responde | (mantém mudo) |
| Nenhum lead para o telefone | Mensagem recebida | Cria `Lead`, envia boas-vindas + pergunta segmento, agenda LEMBRETE | `EM_TRIAGEM/AGUARDANDO_SEGMENTO` |
| Lead mais recente `ABANDONADO` | Mensagem recebida | Igual acima, mas nova linha com `leadAnteriorId` | `EM_TRIAGEM/AGUARDANDO_SEGMENTO` (novo lead) |
| `AGUARDANDO_SEGMENTO` | Resposta válida, opção normal | Grava segmento, envia pergunta volume, zera tentativas, reagenda LEMBRETE | `AGUARDANDO_VOLUME` |
| `AGUARDANDO_SEGMENTO` | Resposta válida, opção "Outros" | Grava segmento, envia pergunta segmento livre, zera tentativas, reagenda LEMBRETE | `AGUARDANDO_SEGMENTO_LIVRE` |
| `AGUARDANDO_SEGMENTO` | Resposta inválida, 1ª vez | Envia "não entendi" + reenvia pergunta, reagenda LEMBRETE | mesma etapa |
| `AGUARDANDO_SEGMENTO` | Resposta inválida, 2ª vez | Encerra por falha → vendedor padrão, transfere com resumo parcial + mensagens do lead | `TRANSFERIDO` |
| `AGUARDANDO_SEGMENTO_LIVRE` | Qualquer texto não vazio | Grava segmento_livre, envia pergunta volume, zera tentativas, reagenda LEMBRETE | `AGUARDANDO_VOLUME` |
| `AGUARDANDO_SEGMENTO_LIVRE` | Sem texto (mídia/vazio) | Mesma mecânica de tentativas inválidas acima | conforme tentativa |
| `AGUARDANDO_VOLUME` | Resposta válida | Grava volume, envia pergunta do nome ("Qual é o seu nome?"), zera tentativas, reagenda LEMBRETE | `AGUARDANDO_NOME` |
| `AGUARDANDO_VOLUME` | Resposta inválida, 1ª / 2ª vez | Mesma mecânica de `AGUARDANDO_SEGMENTO` | mesma etapa / `TRANSFERIDO` |
| `AGUARDANDO_NOME` | Texto não vazio | Grava `nomeContato`; consulta `Roteamento`; achou vendedor → usa; senão → vendedor padrão; envia despedida personalizada ao lead ("Perfeito, {{nome}}! ...") + resumo completo ao vendedor (telefone, nome, segmento/segmento_livre, volume, origem, data/hora); cancela timeout | `TRANSFERIDO` |
| `AGUARDANDO_NOME` | Sem texto (mídia/vazio), 1ª vez | Envia "não entendi" + reenvia pergunta do nome, reagenda LEMBRETE | mesma etapa |
| `AGUARDANDO_NOME` | Sem texto (mídia/vazio), 2ª vez | Encerra por falha → vendedor padrão, transfere com resumo parcial (sem nome) + mensagens do lead | `TRANSFERIDO` |
| `EM_TRIAGEM` (qualquer etapa) | Timeout de LEMBRETE vencido (poller) | Envia lembrete único, reagenda para ABANDONO | mesma etapa |
| `EM_TRIAGEM` (qualquer etapa) | Timeout de ABANDONO vencido (poller) | `estado=ABANDONADO`, mantém tudo que foi respondido | `ABANDONADO` |
| `TRANSFERIDO` | Mensagem recebida | Ignora — bot mudo | `TRANSFERIDO` |

Bordas cobertas: 2ª resposta inválida na mesma pergunta (incl. na pergunta do nome), reinício após abandono, mensagem pós-transferência, corrida poller-vs-mensagem no limite das 24h, resposta sem texto, transferência por qualificação completa (com nome) vs. transferência por falha (sem nome, resumo parcial).

## Plano de etapas (cada uma pequena e testável)

0. **Scaffold + limpeza do repo**: Node LTS + TS estrito, ESLint/Prettier, Vitest, estrutura de pastas acima, `docker-compose.yml` (Postgres), `.env.example`; **reescrever `.gitignore`** (remover o script Python/credencial, colocar regras reais) e **atualizar `README.md`** para descrever o Karen. *Pronto quando*: `npm run build`/`npm test` rodam sobre um teste trivial; `docker compose up -d db` sobe Postgres acessível.
1. **Máquina de estados pura + testes unitários**: `processarEvento` cobrindo toda a tabela de transição, incl. bordas. *Pronto quando*: um teste por linha da tabela, suíte 100% verde, zero import de Prisma/gateway dentro de `domain/`.
2. **Persistência (Prisma) + migrations**: schema acima, migration com o índice único parcial via SQL manual, repositórios concretos. *Pronto quando*: `prisma migrate deploy` aplica em banco limpo; testes de integração de repositório (constraints incluídas) passam contra o Postgres do `docker-compose`.
3. **Transporte simulado ponta-a-ponta**: `GatewayWhatsappSimulado`, caso de uso `ProcessarMensagemRecebida`, REPL de simulação. *Pronto quando*: teste de integração roda uma conversa completa (boas-vindas → inválida → válida → "Outros" → livre → volume → nome → transferência) e confere as mensagens (incl. despedida personalizada com o nome e resumo ao vendedor) + estado final no banco, sem rede real.
4. **Scheduler de timeout (poller)**: `executarPoller(agora)` reaproveitando o mesmo reducer; `worker.ts` chama o poller em intervalo técnico (único `setInterval` do sistema, só como gatilho). *Pronto quando*: teste com `RelogioControlavel` avança o tempo além do lembrete e depois do abandono e confere os efeitos; teste extra recria os serviços "do zero" no meio do fluxo (simula restart) e confirma que retoma do banco corretamente.
5. **Seeds**: `seed-vendedores.ts`, `seed-roteamento.ts`, `seed-configuracao.ts` (incl. opções de menu e textos), documentados no README. *Pronto quando*: banco limpo + `npm run seed` produz configuração operável, validado por teste de integração.
6. **Esqueleto do adapter de WhatsApp real**: stubs em `infraestrutura/whatsapp/gateway-real/` implementando a mesma porta, com comentários nos pontos que dependem do provedor (autenticação, formato de webhook, origem/referral, janela de 24h/templates). Fica parado até você decidir o provedor — nenhuma integração real entra nesta rodada.

## Itens em aberto (não bloqueiam as etapas 0–6, mas precisam de você antes da integração real)

- Provedor de WhatsApp definitivo e suas credenciais/config de produção.
- Ambiente de deploy final (define se o poller é processo contínuo ou cron serverless).
- Fonte da tabela `ClienteExistente` (importação manual, integração com ERP/sistema de vendas?).
- Formato do "origem do clique" (Click-to-WhatsApp Ads da Meta gera referral estruturado; link manual não gera nada — depende do provedor).
- Tela administrativa web: confirmar se continua fora da v1 (scripts de seed cobrem o CRUD por ora).
- Conteúdo literal definitivo dos textos de mensagem (a v1 assume textos de exemplo via seed, editáveis depois).
- Se quer que eu revogue/rotacione a credencial Twilio exposta e/ou reescreva o histórico do git — nenhuma das duas ações está incluída neste plano.

## Verificação

- `npm test` (Vitest) cobrindo domínio (etapa 1), repositórios (etapa 2) e integração ponta-a-ponta com transporte simulado + timeouts via relógio controlável (etapas 3 e 4) — sem qualquer chamada de rede real.
- `docker compose up -d db && npx prisma migrate deploy && npm run seed && npm test` como verificação de ponta a ponta local.
- REPL (`npm run repl` ou similar) para eu conduzir uma conversa manualmente e conferir o comportamento antes de qualquer integração real de WhatsApp.
