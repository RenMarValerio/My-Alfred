import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessarMensagemRecebida } from '../../src/aplicacao/processar-mensagem-recebida.js';
import { RepositorioConfiguracaoPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-configuracao.prisma.js';
import { RepositorioLeadsPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-leads.prisma.js';
import { GatewayWhatsappSimulado } from '../../src/infraestrutura/whatsapp/gateway-simulado.js';
import { RelogioControlavel } from '../../src/infraestrutura/relogio/relogio-controlavel.js';
import { prisma } from '../../src/infraestrutura/persistencia/prisma/cliente.js';
import { limparBanco } from '../db-test-utils.js';

const TELEFONE_LEAD = '+5511999990000';
const TELEFONE_VENDEDOR_PADRAO = '+5511900000001';
const TELEFONE_VENDEDORA_MERCADO = '+5511900000002';

async function seedCompleto() {
  const vendedorPadrao = await prisma.vendedor.create({
    data: { nome: 'Vendedor Padrão', telefoneWhatsapp: TELEFONE_VENDEDOR_PADRAO },
  });
  const vendedoraMercado = await prisma.vendedor.create({
    data: { nome: 'Vendedora Ana', telefoneWhatsapp: TELEFONE_VENDEDORA_MERCADO },
  });

  const segmentos = await Promise.all([
    prisma.opcaoSegmento.create({ data: { ordem: 1, codigo: 'DOCERIA', rotulo: 'Doceria' } }),
    prisma.opcaoSegmento.create({
      data: { ordem: 2, codigo: 'DISTRIBUIDORA_BEBIDAS', rotulo: 'Distribuidora de Bebidas' },
    }),
    prisma.opcaoSegmento.create({ data: { ordem: 3, codigo: 'EMBALAGENS', rotulo: 'Venda de Embalagens' } }),
    prisma.opcaoSegmento.create({ data: { ordem: 4, codigo: 'MERCADO', rotulo: 'Mercado' } }),
    prisma.opcaoSegmento.create({
      data: { ordem: 5, codigo: 'OUTROS', rotulo: 'Outros', permiteTextoLivre: true },
    }),
  ]);
  const volumes = await Promise.all([
    prisma.opcaoVolume.create({ data: { ordem: 1, codigo: 'UNIDADE', rotulo: 'Unidade' } }),
    prisma.opcaoVolume.create({ data: { ordem: 2, codigo: 'CAIXA', rotulo: 'Caixa' } }),
    prisma.opcaoVolume.create({ data: { ordem: 3, codigo: 'PALETE', rotulo: 'Palete' } }),
    prisma.opcaoVolume.create({ data: { ordem: 4, codigo: 'CARGA', rotulo: 'Carga' } }),
  ]);
  const segmentoMercado = segmentos.find((s) => s.codigo === 'MERCADO')!;
  const volumeCarga = volumes.find((v) => v.codigo === 'CARGA')!;

  await prisma.roteamento.create({
    data: { segmentoId: segmentoMercado.id, volumeId: volumeCarga.id, vendedorId: vendedoraMercado.id },
  });
  await prisma.configuracaoGeral.create({
    data: { id: 1, vendedorPadraoId: vendedorPadrao.id, timeoutLembreteMin: 15, timeoutAbandonoH: 24 },
  });

  const textos: Record<string, string> = {
    boas_vindas: 'Olá! Meu nome é Karen, assistente de atendimento da M2 Distribuição. 👋',
    pergunta_segmento_cabecalho: 'Qual é o seu segmento? Responda com o número:',
    pergunta_segmento_livre: 'Jurídico! Me conta qual é o seu segmento?',
    pergunta_volume_cabecalho: 'E qual o volume médio das suas compras? Responda com o número:',
    pergunta_nome: 'Antes de finalizar, qual é o seu nome? 😊',
    nao_entendi: 'Não consegui identificar sua resposta. Posso responder só com o número da opção? 🙏',
    lembrete: 'Ei! Ainda está por aí? É só responder com o número da opção. 😊',
    transferencia_lead: 'Perfeito! Já estou te transferindo para o(a) {{vendedor}}, que vai cuidar do seu atendimento. 😊',
    transferencia_lead_personalizada:
      'Perfeito, {{nome}}! Já estou te transferindo para o(a) {{vendedor}}, que vai cuidar do seu atendimento. 😊',
    notificacao_vendedor:
      'Novo lead — {{nome}} ({{telefone}}). Segmento: {{segmento}}. Volume: {{volume}}. Origem: {{origem}}. Recebido em {{data_hora}}.',
  };
  await Promise.all(
    Object.entries(textos).map(([chave, conteudo]) => prisma.textoMensagem.create({ data: { chave, conteudo } })),
  );

  return { vendedorPadrao, vendedoraMercado };
}

function montarAmbiente(dataInicial: Date) {
  const relogio = new RelogioControlavel(dataInicial);
  const gateway = new GatewayWhatsappSimulado();
  const repositorioLeads = new RepositorioLeadsPrisma();
  const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();
  const processar = new ProcessarMensagemRecebida(repositorioLeads, repositorioConfiguracao, gateway, relogio);
  return { relogio, gateway, repositorioLeads, processar };
}

describe('conversa completa via transporte simulado', () => {
  beforeEach(limparBanco);

  it('percorre boas-vindas → segmento → volume → nome → transferência, sem intervenção humana', async () => {
    await seedCompleto();
    const { gateway, repositorioLeads, processar } = montarAmbiente(new Date('2026-09-01T12:00:00Z'));

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi', nomeWhatsapp: 'João', origem: 'ig-ad-1' });
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('Qual é o seu segmento?');

    // 1ª resposta inválida — reenvia a pergunta com o aviso.
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'não sei' });
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('Não consegui identificar');

    // resposta válida ao segmento -> Mercado
    await processar.executar({ telefone: TELEFONE_LEAD, texto: '4' });
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('volume médio');

    // resposta válida ao volume -> Carga
    await processar.executar({ telefone: TELEFONE_LEAD, texto: '4' });
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('seu nome');

    // nome
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'Maria' });

    const ultimaAoLead = gateway.mensagensPara(TELEFONE_LEAD).at(-1);
    expect(ultimaAoLead?.texto).toBe(
      'Perfeito, Maria! Já estou te transferindo para o(a) Vendedora Ana, que vai cuidar do seu atendimento. 😊',
    );

    const notificacaoVendedor = gateway.mensagensPara(TELEFONE_VENDEDORA_MERCADO).at(-1);
    expect(notificacaoVendedor?.texto).toContain('Maria');
    expect(notificacaoVendedor?.texto).toContain(TELEFONE_LEAD);
    expect(notificacaoVendedor?.texto).toContain('Mercado');
    expect(notificacaoVendedor?.texto).toContain('Carga');
    expect(notificacaoVendedor?.texto).toContain('ig-ad-1');

    const lead = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(lead).toMatchObject({ estado: 'TRANSFERIDO', nomeContato: 'Maria', segmentoCodigo: 'MERCADO' });

    // Mensagem pós-transferência: bot mudo.
    const totalAntes = gateway.mensagensEnviadas.length;
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi de novo' });
    expect(gateway.mensagensEnviadas).toHaveLength(totalAntes);
  });

  it('lead "Outros" grava o texto livre e cai no vendedor padrão, com o texto no resumo', async () => {
    await seedCompleto();
    const { gateway, repositorioLeads, processar } = montarAmbiente(new Date('2026-09-01T12:00:00Z'));

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });
    await processar.executar({ telefone: TELEFONE_LEAD, texto: '5' }); // Outros
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('qual é o seu segmento');

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'Fábrica de velas aromáticas' });
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('volume médio');

    await processar.executar({ telefone: TELEFONE_LEAD, texto: '1' }); // Unidade — sem vendedor cadastrado
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'Carlos' });

    const notificacao = gateway.mensagensPara(TELEFONE_VENDEDOR_PADRAO).at(-1);
    expect(notificacao?.texto).toContain('Fábrica de velas aromáticas');

    const lead = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(lead).toMatchObject({ vendedorId: expect.any(Number), segmentoLivre: 'Fábrica de velas aromáticas' });
  });

  it('duas respostas inválidas seguidas transferem ao vendedor padrão com resumo parcial e a transcrição', async () => {
    await seedCompleto();
    const { gateway, repositorioLeads, processar } = montarAmbiente(new Date('2026-09-01T12:00:00Z'));

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'aaaaa' });
    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'bbbbb' });

    const lead = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(lead).toMatchObject({ estado: 'TRANSFERIDO', vendedorId: expect.any(Number), segmentoCodigo: null });

    const notificacao = gateway.mensagensPara(TELEFONE_VENDEDOR_PADRAO).at(-1);
    expect(notificacao?.texto).toContain('aaaaa');
    expect(notificacao?.texto).toContain('bbbbb');
  });

  it('cliente já existente (allowlist) nunca recebe resposta automática', async () => {
    await seedCompleto();
    await prisma.clienteExistente.create({ data: { telefone: TELEFONE_LEAD } });
    const { gateway, processar } = montarAmbiente(new Date('2026-09-01T12:00:00Z'));

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });
    expect(gateway.mensagensEnviadas).toHaveLength(0);
  });
});
