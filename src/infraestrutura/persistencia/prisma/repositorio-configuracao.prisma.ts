import type { RepositorioConfiguracao } from '../../../aplicacao/portas/repositorio-configuracao.port.js';
import type { ConfiguracaoTriagem } from '../../../domain/triagem/tipos.js';
import { prisma } from './cliente.js';

const ID_CONFIGURACAO_SINGLETON = 1;

export class RepositorioConfiguracaoPrisma implements RepositorioConfiguracao {
  async carregarConfiguracaoTriagem(): Promise<ConfiguracaoTriagem> {
    const [opcoesSegmento, opcoesVolume, roteamento, vendedores, configuracao, textos] =
      await Promise.all([
        prisma.opcaoSegmento.findMany({ where: { ativo: true }, orderBy: { ordem: 'asc' } }),
        prisma.opcaoVolume.findMany({ where: { ativo: true }, orderBy: { ordem: 'asc' } }),
        prisma.roteamento.findMany({ include: { segmento: true, volume: true } }),
        prisma.vendedor.findMany({ where: { ativo: true } }),
        prisma.configuracaoGeral.findUnique({
          where: { id: ID_CONFIGURACAO_SINGLETON },
          include: { vendedorPadrao: true },
        }),
        prisma.textoMensagem.findMany(),
      ]);

    if (!configuracao) {
      throw new Error(
        'Configuração geral não encontrada (esperava a linha singleton id=1). Rode "npm run seed".',
      );
    }

    return {
      opcoesSegmento: opcoesSegmento.map((o) => ({
        ordem: o.ordem,
        codigo: o.codigo,
        rotulo: o.rotulo,
        permiteTextoLivre: o.permiteTextoLivre,
      })),
      opcoesVolume: opcoesVolume.map((o) => ({ ordem: o.ordem, codigo: o.codigo, rotulo: o.rotulo })),
      roteamento: roteamento.map((r) => ({
        segmentoCodigo: r.segmento.codigo,
        volumeCodigo: r.volume.codigo,
        vendedorId: r.vendedorId,
      })),
      vendedorPadrao: {
        id: configuracao.vendedorPadrao.id,
        nome: configuracao.vendedorPadrao.nome,
        telefoneWhatsapp: configuracao.vendedorPadrao.telefoneWhatsapp,
      },
      vendedores: vendedores.map((v) => ({ id: v.id, nome: v.nome, telefoneWhatsapp: v.telefoneWhatsapp })),
      timeoutLembreteMin: configuracao.timeoutLembreteMin,
      timeoutAbandonoH: configuracao.timeoutAbandonoH,
      textos: Object.fromEntries(textos.map((t) => [t.chave, t.conteudo])),
    };
  }
}
