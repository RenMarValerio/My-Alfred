import type { Lead as LeadRow, OpcaoSegmento, OpcaoVolume, Prisma } from '@prisma/client';
import type { MensagemRegistrada, RepositorioLeads } from '../../../aplicacao/portas/repositorio-leads.port.js';
import type { DadosNovoLead, LeadPatch, LeadSnapshot } from '../../../domain/triagem/tipos.js';
import { prisma } from './cliente.js';

type LeadComRelacoes = LeadRow & {
  segmento: OpcaoSegmento | null;
  volume: OpcaoVolume | null;
};

const INCLUDE_RELACOES = { segmento: true, volume: true } as const;

function mapLead(row: LeadComRelacoes): LeadSnapshot {
  return {
    id: row.id,
    telefone: row.telefone,
    nomeWhatsapp: row.nomeWhatsapp,
    origem: row.origem,
    estado: row.estado,
    etapaAtual: row.etapaAtual,
    segmentoCodigo: row.segmento?.codigo ?? null,
    segmentoLivre: row.segmentoLivre,
    volumeCodigo: row.volume?.codigo ?? null,
    nomeContato: row.nomeContato,
    vendedorId: row.vendedorId,
    tentativasInvalidas: row.tentativasInvalidas,
    proximoTimeoutEm: row.proximoTimeoutEm,
    proximoTimeoutTipo: row.proximoTimeoutTipo,
  };
}

export class RepositorioLeadsPrisma implements RepositorioLeads {
  async telefoneEhClienteExistente(telefone: string): Promise<boolean> {
    const row = await prisma.clienteExistente.findUnique({ where: { telefone } });
    return row !== null;
  }

  async buscarMaisRecentePorTelefone(telefone: string): Promise<LeadSnapshot | null> {
    const row = await prisma.lead.findFirst({
      where: { telefone },
      orderBy: { criadoEm: 'desc' },
      include: INCLUDE_RELACOES,
    });
    return row ? mapLead(row) : null;
  }

  async criar(dados: DadosNovoLead, patch: LeadPatch): Promise<LeadSnapshot> {
    const [segmentoId, volumeId] = await Promise.all([
      resolverIdPorCodigo(prisma.opcaoSegmento, patch.segmentoCodigo),
      resolverIdPorCodigo(prisma.opcaoVolume, patch.volumeCodigo),
    ]);

    const row = await prisma.lead.create({
      data: {
        telefone: dados.telefone,
        nomeWhatsapp: dados.nomeWhatsapp,
        origem: dados.origem,
        leadAnteriorId: dados.leadAnteriorId,
        estado: patch.estado ?? 'EM_TRIAGEM',
        etapaAtual: patch.etapaAtual,
        segmentoId,
        volumeId,
        segmentoLivre: patch.segmentoLivre,
        nomeContato: patch.nomeContato,
        vendedorId: patch.vendedorId,
        tentativasInvalidas: patch.tentativasInvalidas ?? 0,
        proximoTimeoutEm: patch.proximoTimeoutEm,
        proximoTimeoutTipo: patch.proximoTimeoutTipo,
        transferidoEm: patch.transferidoEm,
        abandonadoEm: patch.abandonadoEm,
      },
      include: INCLUDE_RELACOES,
    });
    return mapLead(row);
  }

  async atualizar(leadId: number, patch: LeadPatch): Promise<LeadSnapshot> {
    const [segmentoId, volumeId] = await Promise.all([
      resolverIdPorCodigo(prisma.opcaoSegmento, patch.segmentoCodigo),
      resolverIdPorCodigo(prisma.opcaoVolume, patch.volumeCodigo),
    ]);

    const data: Prisma.LeadUpdateInput = {
      estado: patch.estado,
      etapaAtual: patch.etapaAtual,
      segmentoLivre: patch.segmentoLivre,
      nomeContato: patch.nomeContato,
      tentativasInvalidas: patch.tentativasInvalidas,
      proximoTimeoutEm: patch.proximoTimeoutEm,
      proximoTimeoutTipo: patch.proximoTimeoutTipo,
      transferidoEm: patch.transferidoEm,
      abandonadoEm: patch.abandonadoEm,
    };
    if (segmentoId !== undefined) {
      data.segmento = segmentoId === null ? { disconnect: true } : { connect: { id: segmentoId } };
    }
    if (volumeId !== undefined) {
      data.volume = volumeId === null ? { disconnect: true } : { connect: { id: volumeId } };
    }
    if (patch.vendedorId !== undefined) {
      data.vendedor = patch.vendedorId === null ? { disconnect: true } : { connect: { id: patch.vendedorId } };
    }

    const row = await prisma.lead.update({ where: { id: leadId }, data, include: INCLUDE_RELACOES });
    return mapLead(row);
  }

  async registrarMensagem(
    leadId: number,
    mensagem: {
      direcao: 'ENTRADA' | 'SAIDA';
      telefoneRemetente: string;
      telefoneDestinatario: string;
      texto: string;
      tipo?: string;
    },
  ): Promise<void> {
    await prisma.mensagem.create({
      data: {
        leadId,
        direcao: mensagem.direcao,
        telefoneRemetente: mensagem.telefoneRemetente,
        telefoneDestinatario: mensagem.telefoneDestinatario,
        texto: mensagem.texto,
        tipo: mensagem.tipo ?? null,
      },
    });
  }

  async listarMensagens(leadId: number): Promise<MensagemRegistrada[]> {
    const rows = await prisma.mensagem.findMany({
      where: { leadId },
      orderBy: { criadoEm: 'asc' },
    });
    return rows.map((r) => ({
      direcao: r.direcao,
      texto: r.texto,
      tipo: r.tipo,
      criadoEm: r.criadoEm,
    }));
  }

  async buscarComTimeoutVencido(agora: Date, limite = 100): Promise<LeadSnapshot[]> {
    const rows = await prisma.lead.findMany({
      where: { estado: 'EM_TRIAGEM', proximoTimeoutEm: { lte: agora } },
      include: INCLUDE_RELACOES,
      orderBy: { proximoTimeoutEm: 'asc' },
      take: limite,
    });
    return rows.map(mapLead);
  }
}

/**
 * Resolve o `codigo` de negócio (usado pelo domínio) para o `id` interno da tabela
 * (`OpcaoSegmento`/`OpcaoVolume`). `undefined` = campo não tocado pelo patch; `null` = o próprio
 * patch pediu para limpar o campo (não ocorre hoje na máquina de estados, mas é suportado).
 */
async function resolverIdPorCodigo(
  modelo: { findUniqueOrThrow: (args: { where: { codigo: string } }) => Promise<{ id: number }> },
  codigo: string | null | undefined,
): Promise<number | null | undefined> {
  if (codigo === undefined) return undefined;
  if (codigo === null) return null;
  const opcao = await modelo.findUniqueOrThrow({ where: { codigo } });
  return opcao.id;
}
