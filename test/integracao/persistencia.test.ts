import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/infraestrutura/persistencia/prisma/cliente.js';
import { RepositorioConfiguracaoPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-configuracao.prisma.js';
import { RepositorioLeadsPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-leads.prisma.js';
import { limparBanco } from '../db-test-utils.js';

const repositorioLeads = new RepositorioLeadsPrisma();
const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();

async function seedBasico() {
  const vendedorPadrao = await prisma.vendedor.create({
    data: { nome: 'Vendedor Padrão', telefoneWhatsapp: '+5511900000001' },
  });
  const vendedoraAna = await prisma.vendedor.create({
    data: { nome: 'Vendedora Ana', telefoneWhatsapp: '+5511900000002' },
  });
  const segmentoMercado = await prisma.opcaoSegmento.create({
    data: { ordem: 4, codigo: 'MERCADO', rotulo: 'Mercado' },
  });
  const segmentoOutros = await prisma.opcaoSegmento.create({
    data: { ordem: 5, codigo: 'OUTROS', rotulo: 'Outros', permiteTextoLivre: true },
  });
  const volumeCarga = await prisma.opcaoVolume.create({
    data: { ordem: 4, codigo: 'CARGA', rotulo: 'Carga' },
  });
  await prisma.roteamento.create({
    data: { segmentoId: segmentoMercado.id, volumeId: volumeCarga.id, vendedorId: vendedoraAna.id },
  });
  await prisma.configuracaoGeral.create({
    data: { id: 1, vendedorPadraoId: vendedorPadrao.id, timeoutLembreteMin: 15, timeoutAbandonoH: 24 },
  });
  await prisma.textoMensagem.create({ data: { chave: 'boas_vindas', conteudo: 'Olá!' } });

  return { vendedorPadrao, vendedoraAna, segmentoMercado, segmentoOutros, volumeCarga };
}

describe('RepositorioConfiguracaoPrisma', () => {
  beforeEach(limparBanco);

  it('monta a ConfiguracaoTriagem a partir das tabelas relacionadas', async () => {
    const { vendedorPadrao, vendedoraAna } = await seedBasico();

    const config = await repositorioConfiguracao.carregarConfiguracaoTriagem();

    expect(config.vendedorPadrao).toEqual({
      id: vendedorPadrao.id,
      nome: 'Vendedor Padrão',
      telefoneWhatsapp: '+5511900000001',
    });
    expect(config.vendedores).toHaveLength(2);
    expect(config.opcoesSegmento.map((o) => o.codigo)).toEqual(['MERCADO', 'OUTROS']);
    expect(config.opcoesSegmento.find((o) => o.codigo === 'OUTROS')?.permiteTextoLivre).toBe(true);
    expect(config.roteamento).toEqual([
      { segmentoCodigo: 'MERCADO', volumeCodigo: 'CARGA', vendedorId: vendedoraAna.id },
    ]);
    expect(config.timeoutLembreteMin).toBe(15);
    expect(config.timeoutAbandonoH).toBe(24);
    expect(config.textos.boas_vindas).toBe('Olá!');
  });

  it('não considera opções inativas', async () => {
    await seedBasico();
    await prisma.opcaoSegmento.update({ where: { codigo: 'OUTROS' }, data: { ativo: false } });

    const config = await repositorioConfiguracao.carregarConfiguracaoTriagem();
    expect(config.opcoesSegmento.map((o) => o.codigo)).toEqual(['MERCADO']);
  });
});

describe('RepositorioLeadsPrisma', () => {
  beforeEach(limparBanco);

  it('cria um lead novo e o retorna com os campos derivados corretamente', async () => {
    await seedBasico();
    const agora = new Date('2026-09-01T12:00:00Z');

    const leadCriado = await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: 'João', origem: 'instagram-ad', leadAnteriorId: null },
      {
        estado: 'EM_TRIAGEM',
        etapaAtual: 'AGUARDANDO_SEGMENTO',
        tentativasInvalidas: 0,
        proximoTimeoutEm: agora,
        proximoTimeoutTipo: 'LEMBRETE',
      },
    );

    expect(leadCriado).toMatchObject({
      telefone: '+5511999990000',
      nomeWhatsapp: 'João',
      estado: 'EM_TRIAGEM',
      etapaAtual: 'AGUARDANDO_SEGMENTO',
      segmentoCodigo: null,
      volumeCodigo: null,
    });

    const encontrado = await repositorioLeads.buscarMaisRecentePorTelefone('+5511999990000');
    expect(encontrado?.id).toBe(leadCriado.id);
  });

  it('atualiza segmento/volume/vendedor por código de negócio (traduzindo para o id interno)', async () => {
    const { vendedoraAna } = await seedBasico();
    const leadCriado = await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      { estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_SEGMENTO', tentativasInvalidas: 0 },
    );

    const atualizado = await repositorioLeads.atualizar(leadCriado.id, {
      segmentoCodigo: 'MERCADO',
      volumeCodigo: 'CARGA',
      vendedorId: vendedoraAna.id,
      etapaAtual: 'AGUARDANDO_NOME',
    });

    expect(atualizado).toMatchObject({
      segmentoCodigo: 'MERCADO',
      volumeCodigo: 'CARGA',
      vendedorId: vendedoraAna.id,
      etapaAtual: 'AGUARDANDO_NOME',
    });
  });

  it('impede dois leads EM_TRIAGEM simultâneos para o mesmo telefone (índice único parcial)', async () => {
    await seedBasico();
    await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      { estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_SEGMENTO', tentativasInvalidas: 0 },
    );

    await expect(
      repositorioLeads.criar(
        { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
        { estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_SEGMENTO', tentativasInvalidas: 0 },
      ),
    ).rejects.toThrow();
  });

  it('permite um novo ciclo (nova linha) após o anterior estar ABANDONADO — mesmo telefone', async () => {
    await seedBasico();
    const primeiro = await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      { estado: 'ABANDONADO', etapaAtual: null, tentativasInvalidas: 0 },
    );

    const segundo = await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: primeiro.id },
      { estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_SEGMENTO', tentativasInvalidas: 0 },
    );

    expect(segundo.id).not.toBe(primeiro.id);
    const maisRecente = await repositorioLeads.buscarMaisRecentePorTelefone('+5511999990000');
    expect(maisRecente?.id).toBe(segundo.id);
  });

  it('rejeita duas linhas de roteamento para a mesma combinação segmento+volume', async () => {
    const { vendedorPadrao, segmentoMercado, volumeCarga } = await seedBasico();
    await expect(
      prisma.roteamento.create({
        data: { segmentoId: segmentoMercado.id, volumeId: volumeCarga.id, vendedorId: vendedorPadrao.id },
      }),
    ).rejects.toThrow();
  });

  it('registra e lista mensagens em ordem cronológica', async () => {
    await seedBasico();
    const lead = await repositorioLeads.criar(
      { telefone: '+5511999990000', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      { estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_SEGMENTO', tentativasInvalidas: 0 },
    );

    await repositorioLeads.registrarMensagem(lead.id, {
      direcao: 'SAIDA',
      telefoneRemetente: '+5511900000001',
      telefoneDestinatario: '+5511999990000',
      texto: 'Olá!',
      tipo: 'BOAS_VINDAS',
    });
    await repositorioLeads.registrarMensagem(lead.id, {
      direcao: 'ENTRADA',
      telefoneRemetente: '+5511999990000',
      telefoneDestinatario: '+5511900000001',
      texto: '1',
    });

    const mensagens = await repositorioLeads.listarMensagens(lead.id);
    expect(mensagens.map((m) => m.direcao)).toEqual(['SAIDA', 'ENTRADA']);
    expect(mensagens[1]).toMatchObject({ texto: '1', tipo: null });
  });

  it('busca leads com timeout vencido, ordenados pelo mais atrasado primeiro', async () => {
    await seedBasico();
    const agora = new Date('2026-09-01T12:00:00Z');
    const maisAtrasado = new Date('2026-09-01T10:00:00Z');
    const menosAtrasado = new Date('2026-09-01T11:30:00Z');
    const futuro = new Date('2026-09-01T13:00:00Z');

    const leadA = await repositorioLeads.criar(
      { telefone: '+5511999990001', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      {
        estado: 'EM_TRIAGEM',
        etapaAtual: 'AGUARDANDO_SEGMENTO',
        tentativasInvalidas: 0,
        proximoTimeoutEm: menosAtrasado,
        proximoTimeoutTipo: 'LEMBRETE',
      },
    );
    const leadB = await repositorioLeads.criar(
      { telefone: '+5511999990002', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      {
        estado: 'EM_TRIAGEM',
        etapaAtual: 'AGUARDANDO_SEGMENTO',
        tentativasInvalidas: 0,
        proximoTimeoutEm: maisAtrasado,
        proximoTimeoutTipo: 'LEMBRETE',
      },
    );
    await repositorioLeads.criar(
      { telefone: '+5511999990003', nomeWhatsapp: null, origem: null, leadAnteriorId: null },
      {
        estado: 'EM_TRIAGEM',
        etapaAtual: 'AGUARDANDO_SEGMENTO',
        tentativasInvalidas: 0,
        proximoTimeoutEm: futuro,
        proximoTimeoutTipo: 'LEMBRETE',
      },
    );

    const vencidos = await repositorioLeads.buscarComTimeoutVencido(agora);
    expect(vencidos.map((l) => l.id)).toEqual([leadB.id, leadA.id]);
  });

  it('telefoneEhClienteExistente reflete a allowlist', async () => {
    await seedBasico();
    await prisma.clienteExistente.create({ data: { telefone: '+5511988880000' } });

    await expect(repositorioLeads.telefoneEhClienteExistente('+5511988880000')).resolves.toBe(true);
    await expect(repositorioLeads.telefoneEhClienteExistente('+5511999999999')).resolves.toBe(false);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
