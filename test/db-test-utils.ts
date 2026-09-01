import { prisma } from '../src/infraestrutura/persistencia/prisma/cliente.js';

/** Limpa todas as tabelas (respeitando FKs) entre testes de integração. */
export async function limparBanco(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      mensagens, leads, roteamento, configuracao_geral, textos_mensagem,
      opcoes_segmento, opcoes_volume, vendedores, clientes_existentes
    RESTART IDENTITY CASCADE;
  `);
}
