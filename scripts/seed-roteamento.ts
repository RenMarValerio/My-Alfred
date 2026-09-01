import { prisma } from '../src/infraestrutura/persistencia/prisma/cliente.js';
import { seedVendedores } from './seed-vendedores.js';

/**
 * Linhas de exemplo da tabela de roteamento — cadastrar ou trocar o vendedor de uma combinação
 * é só editar esta lista (ou, futuramente, a tela admin) e rodar o seed de novo. Combinações não
 * listadas aqui caem no vendedor padrão (configurado em `seed-configuracao.ts`) — nenhum lead
 * fica sem destino.
 */
const REGRAS = [
  { segmentoCodigo: 'DOCERIA', volumeCodigo: 'CAIXA', vendedorCodigo: 'DOCERIA' },
  { segmentoCodigo: 'DISTRIBUIDORA_BEBIDAS', volumeCodigo: 'PALETE', vendedorCodigo: 'BEBIDAS' },
  { segmentoCodigo: 'MERCADO', volumeCodigo: 'CARGA', vendedorCodigo: 'MERCADO_CARGA' },
] as const;

function idObrigatorio(mapa: Record<string, number>, codigo: string): number {
  const id = mapa[codigo];
  if (id == null) throw new Error(`Vendedor de código "${codigo}" não encontrado no seed.`);
  return id;
}

export async function seedRoteamento(): Promise<void> {
  const vendedores = await seedVendedores();

  for (const regra of REGRAS) {
    const [segmento, volume] = await Promise.all([
      prisma.opcaoSegmento.findUniqueOrThrow({ where: { codigo: regra.segmentoCodigo } }),
      prisma.opcaoVolume.findUniqueOrThrow({ where: { codigo: regra.volumeCodigo } }),
    ]);
    const vendedorId = idObrigatorio(vendedores, regra.vendedorCodigo);

    await prisma.roteamento.upsert({
      where: { segmentoId_volumeId: { segmentoId: segmento.id, volumeId: volume.id } },
      update: { vendedorId },
      create: { segmentoId: segmento.id, volumeId: volume.id, vendedorId },
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedRoteamento()
    .then(() => {
      console.log('Tabela de roteamento seedada.');
      return prisma.$disconnect();
    })
    .catch(async (erro) => {
      console.error(erro);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
