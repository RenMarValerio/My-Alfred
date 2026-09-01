-- CreateEnum
CREATE TYPE "EstadoLead" AS ENUM ('EM_TRIAGEM', 'TRANSFERIDO', 'ABANDONADO');

-- CreateEnum
CREATE TYPE "EtapaTriagem" AS ENUM ('AGUARDANDO_SEGMENTO', 'AGUARDANDO_SEGMENTO_LIVRE', 'AGUARDANDO_VOLUME', 'AGUARDANDO_NOME');

-- CreateEnum
CREATE TYPE "TipoTimeout" AS ENUM ('LEMBRETE', 'ABANDONO');

-- CreateEnum
CREATE TYPE "DirecaoMensagem" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateTable
CREATE TABLE "opcoes_segmento" (
    "id" SERIAL NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "permiteTextoLivre" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "opcoes_segmento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opcoes_volume" (
    "id" SERIAL NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "opcoes_volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendedores" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone_whatsapp" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vendedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roteamento" (
    "id" SERIAL NOT NULL,
    "segmento_id" INTEGER NOT NULL,
    "volume_id" INTEGER NOT NULL,
    "vendedor_id" INTEGER NOT NULL,

    CONSTRAINT "roteamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao_geral" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "vendedor_padrao_id" INTEGER NOT NULL,
    "timeout_lembrete_min" INTEGER NOT NULL DEFAULT 15,
    "timeout_abandono_h" INTEGER NOT NULL DEFAULT 24,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_geral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textos_mensagem" (
    "chave" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "descricao" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "textos_mensagem_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome_whatsapp" TEXT,
    "nome_contato" TEXT,
    "origem" TEXT,
    "estado" "EstadoLead" NOT NULL DEFAULT 'EM_TRIAGEM',
    "etapa_atual" "EtapaTriagem",
    "segmento_id" INTEGER,
    "segmento_livre" TEXT,
    "volume_id" INTEGER,
    "vendedor_id" INTEGER,
    "tentativas_invalidas" INTEGER NOT NULL DEFAULT 0,
    "proximo_timeout_em" TIMESTAMP(3),
    "proximo_timeout_tipo" "TipoTimeout",
    "lead_anterior_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "transferido_em" TIMESTAMP(3),
    "abandonado_em" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "direcao" "DirecaoMensagem" NOT NULL,
    "telefone_remetente" TEXT NOT NULL,
    "telefone_destinatario" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes_existentes" (
    "telefone" TEXT NOT NULL,
    "origem_import" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_existentes_pkey" PRIMARY KEY ("telefone")
);

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_segmento_ordem_key" ON "opcoes_segmento"("ordem");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_segmento_codigo_key" ON "opcoes_segmento"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_volume_ordem_key" ON "opcoes_volume"("ordem");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_volume_codigo_key" ON "opcoes_volume"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "vendedores_telefone_whatsapp_key" ON "vendedores"("telefone_whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "roteamento_segmento_id_volume_id_key" ON "roteamento"("segmento_id", "volume_id");

-- CreateIndex
CREATE INDEX "leads_telefone_idx" ON "leads"("telefone");

-- CreateIndex
CREATE INDEX "leads_estado_proximo_timeout_em_idx" ON "leads"("estado", "proximo_timeout_em");

-- CreateIndex
CREATE INDEX "mensagens_lead_id_criado_em_idx" ON "mensagens"("lead_id", "criado_em");

-- AddForeignKey
ALTER TABLE "roteamento" ADD CONSTRAINT "roteamento_segmento_id_fkey" FOREIGN KEY ("segmento_id") REFERENCES "opcoes_segmento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roteamento" ADD CONSTRAINT "roteamento_volume_id_fkey" FOREIGN KEY ("volume_id") REFERENCES "opcoes_volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roteamento" ADD CONSTRAINT "roteamento_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_geral" ADD CONSTRAINT "configuracao_geral_vendedor_padrao_id_fkey" FOREIGN KEY ("vendedor_padrao_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_segmento_id_fkey" FOREIGN KEY ("segmento_id") REFERENCES "opcoes_segmento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_volume_id_fkey" FOREIGN KEY ("volume_id") REFERENCES "opcoes_volume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índice único PARCIAL: no máximo um lead "ativo" (EM_TRIAGEM) por telefone ao mesmo tempo.
-- Prisma não expressa índice parcial no schema.prisma — mantido como SQL manual nesta migration
-- (ver docs/arquitetura.md, seção "Schema do banco").
CREATE UNIQUE INDEX "leads_telefone_ativo_key" ON "leads"("telefone") WHERE "estado" = 'EM_TRIAGEM';
