# Karen — Bot de triagem de leads via WhatsApp (M2 Distribuição)

Bot de triagem determinístico (sem IA/LLM) para o primeiro contato de leads que chegam pelo
WhatsApp da M2 Distribuição a partir de anúncios em Instagram/Facebook. A Karen faz duas
perguntas de qualificação por menu numerado (segmento e volume médio de compra), pergunta o
nome do contato, roteia o lead por uma tabela configurável (segmento × volume) e transfere a
conversa ao vendedor correspondente — sem nenhuma regra de negócio hardcoded: textos de
mensagem, opções de menu e tabela de roteamento vêm do banco de dados.

O desenho completo (arquitetura, schema de banco, máquina de estados e plano de etapas) está
documentado em [`docs/arquitetura.md`](./docs/arquitetura.md).

## Stack

- Node.js + TypeScript
- PostgreSQL + Prisma (ORM/migrations)
- Vitest (testes)
- Arquitetura hexagonal (ports & adapters): o motor da máquina de estados não depende de
  nenhum provedor de WhatsApp específico — a integração real é conectada por um adapter,
  trocável sem alterar a regra de negócio.

## Como rodar localmente

```bash
cp .env.example .env
docker compose up -d db
npm install
npx prisma migrate deploy
npm run seed
npm test
```

## Scripts

- `npm run build` — compila o TypeScript.
- `npm test` — roda a suíte de testes (Vitest).
- `npm run seed` — popula vendedores, tabela de roteamento e configuração/textos de mensagem.
- `npm run repl` — REPL de simulação de conversa (transporte simulado, sem WhatsApp real) para
  testar o fluxo manualmente.
- `npm run worker` — sobe o processo que executa o poller de timeouts (lembrete/abandono).

## Status

Provedor de WhatsApp real e ambiente de deploy ainda não definidos — ver
[`docs/arquitetura.md`](./docs/arquitetura.md#itens-em-aberto). A integração real fica isolada
atrás de um adapter (`src/infraestrutura/whatsapp/gateway-real/`), hoje apenas com esqueleto.
