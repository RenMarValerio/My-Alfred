import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessarMensagemRecebida } from '../../src/aplicacao/processar-mensagem-recebida.js';
import { ExecutarPollerTimeouts } from '../../src/aplicacao/executar-poller-timeouts.js';
import { RepositorioConfiguracaoPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-configuracao.prisma.js';
import { RepositorioLeadsPrisma } from '../../src/infraestrutura/persistencia/prisma/repositorio-leads.prisma.js';
import { GatewayWhatsappSimulado } from '../../src/infraestrutura/whatsapp/gateway-simulado.js';
import { RelogioControlavel } from '../../src/infraestrutura/relogio/relogio-controlavel.js';
import { prisma } from '../../src/infraestrutura/persistencia/prisma/cliente.js';
import { limparBanco } from '../db-test-utils.js';

const TELEFONE_LEAD = '+5511999990000';

async function seedMinimo() {
  const vendedorPadrao = await prisma.vendedor.create({
    data: { nome: 'Vendedor Padrão', telefoneWhatsapp: '+5511900000001' },
  });
  await prisma.opcaoSegmento.create({ data: { ordem: 1, codigo: 'DOCERIA', rotulo: 'Doceria' } });
  await prisma.opcaoVolume.create({ data: { ordem: 1, codigo: 'UNIDADE', rotulo: 'Unidade' } });
  await prisma.configuracaoGeral.create({
    data: { id: 1, vendedorPadraoId: vendedorPadrao.id, timeoutLembreteMin: 15, timeoutAbandonoH: 24 },
  });
  const textos: Record<string, string> = {
    boas_vindas: 'Olá! Meu nome é Karen.',
    pergunta_segmento_cabecalho: 'Qual é o seu segmento?',
    pergunta_segmento_livre: 'Qual é o seu segmento?',
    pergunta_volume_cabecalho: 'Qual o volume?',
    pergunta_nome: 'Qual é o seu nome?',
    nao_entendi: 'Não consegui identificar sua resposta.',
    lembrete: 'Ei! Ainda está por aí? 😊',
    transferencia_lead: 'Perfeito! Já estou te transferindo para o(a) {{vendedor}}.',
    transferencia_lead_personalizada: 'Perfeito, {{nome}}! Já estou te transferindo para o(a) {{vendedor}}.',
    notificacao_vendedor: '{{nome}} / {{telefone}} / {{segmento}} / {{volume}} / {{origem}} / {{data_hora}}',
  };
  await Promise.all(
    Object.entries(textos).map(([chave, conteudo]) => prisma.textoMensagem.create({ data: { chave, conteudo } })),
  );
}

describe('poller de timeouts', () => {
  beforeEach(limparBanco);

  it('envia um lembrete único após 15min sem resposta e reagenda para abandono em 24h', async () => {
    await seedMinimo();
    const relogio = new RelogioControlavel(new Date('2026-09-01T12:00:00Z'));
    const gateway = new GatewayWhatsappSimulado();
    const repositorioLeads = new RepositorioLeadsPrisma();
    const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();
    const processar = new ProcessarMensagemRecebida(repositorioLeads, repositorioConfiguracao, gateway, relogio);
    const poller = new ExecutarPollerTimeouts(repositorioLeads, repositorioConfiguracao, gateway, relogio);

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });

    // Antes de vencer o lembrete, o poller não faz nada.
    relogio.avancar({ minutos: 10 });
    expect(await poller.executar()).toBe(0);

    // Vence o lembrete de 15min.
    relogio.avancar({ minutos: 6 });
    expect(await poller.executar()).toBe(1);
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('Ainda está por aí');

    const lead = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(lead).toMatchObject({ estado: 'EM_TRIAGEM', proximoTimeoutTipo: 'ABANDONO' });

    // Não vence de novo antes de completar as 24h de abandono.
    relogio.avancar({ horas: 20 });
    expect(await poller.executar()).toBe(0);

    // Vence o abandono.
    relogio.avancar({ horas: 4, minutos: 1 });
    expect(await poller.executar()).toBe(1);

    const leadAbandonado = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(leadAbandonado).toMatchObject({ estado: 'ABANDONADO' });
    // Nenhuma mensagem é enviada ao marcar como abandonado.
    expect(gateway.mensagensPara(TELEFONE_LEAD)).toHaveLength(2); // boas-vindas + lembrete
  });

  it('mensagem após 24h abandonado reinicia a triagem do zero, preservando o ciclo anterior', async () => {
    await seedMinimo();
    const relogio = new RelogioControlavel(new Date('2026-09-01T12:00:00Z'));
    const gateway = new GatewayWhatsappSimulado();
    const repositorioLeads = new RepositorioLeadsPrisma();
    const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();
    const processar = new ProcessarMensagemRecebida(repositorioLeads, repositorioConfiguracao, gateway, relogio);
    const poller = new ExecutarPollerTimeouts(repositorioLeads, repositorioConfiguracao, gateway, relogio);

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });
    const leadAntigo = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);

    relogio.avancar({ minutos: 20 });
    await poller.executar(); // dispara o lembrete
    relogio.avancar({ horas: 25 });
    await poller.executar(); // marca como abandonado

    await processar.executar({ telefone: TELEFONE_LEAD, texto: 'oi de novo' });

    const leadNovo = await repositorioLeads.buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(leadNovo?.estado).toBe('EM_TRIAGEM');
    expect(leadNovo?.id).not.toBe(leadAntigo?.id);
    expect(gateway.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('Qual é o seu segmento?');
  });

  it('sobrevive a um "restart do processo" — novas instâncias retomam o estado a partir do banco', async () => {
    await seedMinimo();
    const relogio = new RelogioControlavel(new Date('2026-09-01T12:00:00Z'));
    const gatewayAntes = new GatewayWhatsappSimulado();
    const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();

    const processarAntesDoRestart = new ProcessarMensagemRecebida(
      new RepositorioLeadsPrisma(),
      repositorioConfiguracao,
      gatewayAntes,
      relogio,
    );
    await processarAntesDoRestart.executar({ telefone: TELEFONE_LEAD, texto: 'oi' });
    await processarAntesDoRestart.executar({ telefone: TELEFONE_LEAD, texto: '1' }); // segmento válido

    relogio.avancar({ minutos: 16 }); // vence o lembrete agendado na 2ª pergunta (volume)

    // "Restart": novas instâncias de tudo, nada de estado em memória reaproveitado.
    const gatewayDepois = new GatewayWhatsappSimulado();
    const pollerDepoisDoRestart = new ExecutarPollerTimeouts(
      new RepositorioLeadsPrisma(),
      new RepositorioConfiguracaoPrisma(),
      gatewayDepois,
      relogio,
    );

    const processados = await pollerDepoisDoRestart.executar();
    expect(processados).toBe(1);
    expect(gatewayDepois.mensagensPara(TELEFONE_LEAD).at(-1)?.texto).toContain('Ainda está por aí');

    const lead = await new RepositorioLeadsPrisma().buscarMaisRecentePorTelefone(TELEFONE_LEAD);
    expect(lead).toMatchObject({ estado: 'EM_TRIAGEM', etapaAtual: 'AGUARDANDO_VOLUME' });
  });
});
