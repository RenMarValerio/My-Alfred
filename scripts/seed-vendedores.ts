import { prisma } from '../src/infraestrutura/persistencia/prisma/cliente.js';

/**
 * Vendedores de exemplo — TROQUE pelos vendedores reais da M2 Distribuição antes de operar em
 * produção. Cadastrar/trocar um vendedor é só editar esta lista (ou, futuramente, a tela admin)
 * e rodar o seed de novo — nunca requer alteração de código em outro lugar do sistema.
 */
const VENDEDORES = [
  { codigo: 'PADRAO', nome: 'Vendedor Padrão', telefoneWhatsapp: '+5511900000001' },
  { codigo: 'DOCERIA', nome: 'Vendedora Doceria', telefoneWhatsapp: '+5511900000002' },
  { codigo: 'BEBIDAS', nome: 'Vendedor Bebidas', telefoneWhatsapp: '+5511900000003' },
  { codigo: 'MERCADO_CARGA', nome: 'Vendedora Mercado (carga fechada)', telefoneWhatsapp: '+5511900000004' },
] as const;

export async function seedVendedores(): Promise<Record<string, number>> {
  const idsPorCodigo: Record<string, number> = {};

  for (const vendedor of VENDEDORES) {
    const row = await prisma.vendedor.upsert({
      where: { telefoneWhatsapp: vendedor.telefoneWhatsapp },
      update: { nome: vendedor.nome, ativo: true },
      create: { nome: vendedor.nome, telefoneWhatsapp: vendedor.telefoneWhatsapp },
    });
    idsPorCodigo[vendedor.codigo] = row.id;
  }

  return idsPorCodigo;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedVendedores()
    .then((ids) => {
      console.log('Vendedores seedados:', ids);
      return prisma.$disconnect();
    })
    .catch(async (erro) => {
      console.error(erro);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
