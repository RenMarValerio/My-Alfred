import { describe, expect, it } from 'vitest';
import { processarEvento } from '../maquina-estados.js';
import type { ConfiguracaoTriagem, EntradaProcessamento, LeadSnapshot } from '../tipos.js';

const AGORA = new Date('2026-09-01T12:00:00-03:00');

function config(overrides: Partial<ConfiguracaoTriagem> = {}): ConfiguracaoTriagem {
  return {
    opcoesSegmento: [
      { ordem: 1, codigo: 'DOCERIA', rotulo: 'Doceria' },
      { ordem: 2, codigo: 'DISTRIBUIDORA_BEBIDAS', rotulo: 'Distribuidora de Bebidas' },
      { ordem: 3, codigo: 'EMBALAGENS', rotulo: 'Venda de Embalagens' },
      { ordem: 4, codigo: 'MERCADO', rotulo: 'Mercado' },
      { ordem: 5, codigo: 'OUTROS', rotulo: 'Outros', permiteTextoLivre: true },
    ],
    opcoesVolume: [
      { ordem: 1, codigo: 'UNIDADE', rotulo: 'Unidade' },
      { ordem: 2, codigo: 'CAIXA', rotulo: 'Caixa' },
      { ordem: 3, codigo: 'PALETE', rotulo: 'Palete' },
      { ordem: 4, codigo: 'CARGA', rotulo: 'Carga' },
    ],
    roteamento: [{ segmentoCodigo: 'MERCADO', volumeCodigo: 'CARGA', vendedorId: 2 }],
    vendedorPadrao: { id: 1, nome: 'Vendedor Padrão', telefoneWhatsapp: '+5511900000001' },
    vendedores: [
      { id: 1, nome: 'Vendedor Padrão', telefoneWhatsapp: '+5511900000001' },
      { id: 2, nome: 'Vendedora Ana', telefoneWhatsapp: '+5511900000002' },
    ],
    timeoutLembreteMin: 15,
    timeoutAbandonoH: 24,
    textos: {
      boas_vindas: 'Olá! Meu nome é Karen.',
      pergunta_segmento_cabecalho: 'Qual é o seu segmento?',
      pergunta_segmento_livre: 'Me conta qual é o seu segmento?',
      pergunta_volume_cabecalho: 'E qual o volume médio das suas compras?',
      pergunta_nome: 'Qual é o seu nome?',
      nao_entendi: 'Não consegui identificar sua resposta.',
      lembrete: 'Ei! Ainda está por aí?',
      transferencia_lead: 'Perfeito! Já estou te transferindo para o(a) {{vendedor}}.',
      transferencia_lead_personalizada: 'Perfeito, {{nome}}! Já estou te transferindo para o(a) {{vendedor}}.',
      notificacao_vendedor:
        'Novo lead: {{nome}} ({{telefone}}) - {{segmento}} / {{volume}} - origem {{origem}} - {{data_hora}}',
    },
    ...overrides,
  };
}

function lead(overrides: Partial<LeadSnapshot> = {}): LeadSnapshot {
  return {
    id: 1,
    telefone: '+5511999990000',
    nomeWhatsapp: 'João',
    origem: 'instagram-ad-123',
    estado: 'EM_TRIAGEM',
    etapaAtual: 'AGUARDANDO_SEGMENTO',
    segmentoCodigo: null,
    segmentoLivre: null,
    volumeCodigo: null,
    nomeContato: null,
    vendedorId: null,
    tentativasInvalidas: 0,
    proximoTimeoutEm: null,
    proximoTimeoutTipo: null,
    ...overrides,
  };
}

function base(overrides: Partial<EntradaProcessamento> = {}): EntradaProcessamento {
  return {
    telefone: '+5511999990000',
    telefoneClienteExistente: false,
    leadMaisRecente: null,
    evento: { tipo: 'MENSAGEM_RECEBIDA', texto: null },
    config: config(),
    agora: AGORA,
    ...overrides,
  };
}

describe('cliente existente / lead transferido — bot nunca responde', () => {
  it('ignora qualquer mensagem de telefone marcado como cliente existente', () => {
    const resultado = processarEvento(
      base({ telefoneClienteExistente: true, evento: { tipo: 'MENSAGEM_RECEBIDA', texto: '1' } }),
    );
    expect(resultado.acao).toBe('IGNORAR');
  });

  it('ignora mensagem para lead já TRANSFERIDO', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: lead({ estado: 'TRANSFERIDO', etapaAtual: null }),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'oi' },
      }),
    );
    expect(resultado.acao).toBe('IGNORAR');
  });
});

describe('boas-vindas / criação de lead', () => {
  it('cria lead novo e envia boas-vindas + pergunta de segmento na primeira mensagem', () => {
    const resultado = processarEvento(base({ evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'oi' } }));
    expect(resultado.acao).toBe('CRIAR_LEAD');
    if (resultado.acao !== 'CRIAR_LEAD') throw new Error('esperava CRIAR_LEAD');

    expect(resultado.dadosNovoLead.telefone).toBe('+5511999990000');
    expect(resultado.dadosNovoLead.leadAnteriorId).toBeNull();
    expect(resultado.patch.etapaAtual).toBe('AGUARDANDO_SEGMENTO');
    expect(resultado.patch.proximoTimeoutTipo).toBe('LEMBRETE');
    expect(resultado.efeitos).toHaveLength(1);
    expect(resultado.efeitos[0]).toMatchObject({ tipo: 'ENVIAR_AO_LEAD', tipoMensagem: 'BOAS_VINDAS' });
    expect(resultado.efeitos[0]).toMatchObject({
      texto: expect.stringContaining('Qual é o seu segmento?'),
    });
  });

  it('reinicia do zero (novo lead) quando o lead mais recente estava ABANDONADO, ligando leadAnteriorId', () => {
    const leadAntigo = lead({ id: 42, estado: 'ABANDONADO', etapaAtual: null });
    const resultado = processarEvento(
      base({ leadMaisRecente: leadAntigo, evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'oi de novo' } }),
    );
    expect(resultado.acao).toBe('CRIAR_LEAD');
    if (resultado.acao !== 'CRIAR_LEAD') throw new Error('esperava CRIAR_LEAD');
    expect(resultado.dadosNovoLead.leadAnteriorId).toBe(42);
    expect(resultado.patch.etapaAtual).toBe('AGUARDANDO_SEGMENTO');
  });
});

describe('AGUARDANDO_SEGMENTO', () => {
  it('resposta válida (opção normal) avança para AGUARDANDO_VOLUME', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: lead(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: '1' } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ segmentoCodigo: 'DOCERIA', etapaAtual: 'AGUARDANDO_VOLUME' });
    expect(resultado.patch.tentativasInvalidas).toBe(0);
    expect(resultado.efeitos[0]).toMatchObject({
      texto: expect.stringContaining('volume médio'),
    });
  });

  it.each(['1', '1.', '1 -', '1)', 'doceria', 'DOCERIA'])(
    'aceita a variação de resposta "%s"',
    (texto) => {
      const resultado = processarEvento(
        base({ leadMaisRecente: lead(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto } }),
      );
      expect(resultado.acao).toBe('ATUALIZAR_LEAD');
      if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
      expect(resultado.patch.segmentoCodigo).toBe('DOCERIA');
    },
  );

  it('resposta válida "Outros" avança para AGUARDANDO_SEGMENTO_LIVRE', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: lead(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: '5' } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({
      segmentoCodigo: 'OUTROS',
      etapaAtual: 'AGUARDANDO_SEGMENTO_LIVRE',
    });
  });

  it('1ª resposta inválida reenvia a pergunta e incrementa tentativas', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: lead(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'blablabla' } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.tentativasInvalidas).toBe(1);
    expect(resultado.patch.etapaAtual).toBeUndefined(); // não muda de etapa
    expect(resultado.efeitos[0]).toMatchObject({ tipoMensagem: 'INVALIDA' });
    expect(resultado.efeitos[0]).toMatchObject({
      texto: expect.stringContaining('Não consegui identificar'),
    });
  });

  it('2ª resposta inválida encerra a triagem e transfere ao vendedor padrão com resumo parcial', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: lead({ tentativasInvalidas: 1 }),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'ainda não entendi nada' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ estado: 'TRANSFERIDO', vendedorId: 1, etapaAtual: null });
    expect(resultado.patch.transferidoEm).toEqual(AGORA);

    const notificacao = resultado.efeitos.find((e) => e.tipo === 'NOTIFICAR_VENDEDOR');
    expect(notificacao).toMatchObject({ vendedorId: 1, incluirTranscricaoCompleta: true });

    const paraLead = resultado.efeitos.find((e) => e.tipo === 'ENVIAR_AO_LEAD');
    expect(paraLead).toMatchObject({ texto: expect.stringContaining('Vendedor Padrão') });
  });
});

describe('AGUARDANDO_SEGMENTO_LIVRE', () => {
  const leadNoSegmentoLivre = () => lead({ etapaAtual: 'AGUARDANDO_SEGMENTO_LIVRE', segmentoCodigo: 'OUTROS' });

  it('qualquer texto não vazio grava segmento_livre e avança para volume', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: leadNoSegmentoLivre(),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'Fábrica de velas aromáticas' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({
      segmentoLivre: 'Fábrica de velas aromáticas',
      etapaAtual: 'AGUARDANDO_VOLUME',
    });
  });

  it('mensagem sem texto (mídia/vazia) conta como tentativa inválida', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: leadNoSegmentoLivre(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: null } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.tentativasInvalidas).toBe(1);
  });
});

describe('AGUARDANDO_VOLUME', () => {
  const leadNoVolume = () => lead({ etapaAtual: 'AGUARDANDO_VOLUME', segmentoCodigo: 'MERCADO' });

  it('resposta válida avança para AGUARDANDO_NOME (não transfere direto)', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: leadNoVolume(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: '4' } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ volumeCodigo: 'CARGA', etapaAtual: 'AGUARDANDO_NOME' });
    expect(resultado.efeitos[0]).toMatchObject({ texto: expect.stringContaining('seu nome') });
  });

  it('2ª resposta inválida transfere ao vendedor padrão com o que já foi coletado', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: { ...leadNoVolume(), tentativasInvalidas: 1 },
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'nao sei' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.estado).toBe('TRANSFERIDO');
  });
});

describe('AGUARDANDO_NOME', () => {
  const leadAguardandoNome = (overrides: Partial<LeadSnapshot> = {}) =>
    lead({
      etapaAtual: 'AGUARDANDO_NOME',
      segmentoCodigo: 'MERCADO',
      volumeCodigo: 'CARGA',
      ...overrides,
    });

  it('texto válido conclui a triagem: roteia pelo vendedor correto, grava nome e envia despedida personalizada', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: leadAguardandoNome(),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'Maria' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ estado: 'TRANSFERIDO', nomeContato: 'Maria', vendedorId: 2 });

    const paraLead = resultado.efeitos.find((e) => e.tipo === 'ENVIAR_AO_LEAD');
    expect(paraLead).toMatchObject({
      texto: 'Perfeito, Maria! Já estou te transferindo para o(a) Vendedora Ana.',
    });

    const notificacao = resultado.efeitos.find((e) => e.tipo === 'NOTIFICAR_VENDEDOR');
    expect(notificacao).toMatchObject({ vendedorId: 2 });
    expect(notificacao && 'texto' in notificacao && notificacao.texto).toContain('Maria');
  });

  it('sem vendedor cadastrado para a combinação, usa o vendedor padrão', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: leadAguardandoNome({ segmentoCodigo: 'DOCERIA', volumeCodigo: 'UNIDADE' }),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: 'Pedro' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.vendedorId).toBe(1);
  });

  it('1ª resposta sem texto reenvia a pergunta do nome', () => {
    const resultado = processarEvento(
      base({ leadMaisRecente: leadAguardandoNome(), evento: { tipo: 'MENSAGEM_RECEBIDA', texto: null } }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.tentativasInvalidas).toBe(1);
    expect(resultado.efeitos[0]).toMatchObject({ texto: expect.stringContaining('seu nome') });
  });

  it('2ª resposta sem texto encerra por falha, transferindo sem nome', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: leadAguardandoNome({ tentativasInvalidas: 1 }),
        evento: { tipo: 'MENSAGEM_RECEBIDA', texto: '' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ estado: 'TRANSFERIDO', vendedorId: 1 });
    expect(resultado.patch.nomeContato).toBeUndefined();

    const notificacao = resultado.efeitos.find((e) => e.tipo === 'NOTIFICAR_VENDEDOR');
    expect(notificacao && 'texto' in notificacao && notificacao.texto).toContain('(não informado)');
  });
});

describe('timeouts (poller)', () => {
  it('timeout de lembrete envia mensagem única e reagenda para abandono', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: lead({ proximoTimeoutTipo: 'LEMBRETE' }),
        evento: { tipo: 'TIMEOUT_LEMBRETE' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch.proximoTimeoutTipo).toBe('ABANDONO');
    expect(resultado.efeitos[0]).toMatchObject({ tipoMensagem: 'LEMBRETE' });

    const esperado = new Date(AGORA);
    esperado.setHours(esperado.getHours() + 24);
    expect(resultado.patch.proximoTimeoutEm).toEqual(esperado);
  });

  it('timeout de abandono marca o lead como ABANDONADO sem enviar mensagem', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: lead({ proximoTimeoutTipo: 'ABANDONO' }),
        evento: { tipo: 'TIMEOUT_ABANDONO' },
      }),
    );
    expect(resultado.acao).toBe('ATUALIZAR_LEAD');
    if (resultado.acao !== 'ATUALIZAR_LEAD') throw new Error('esperava ATUALIZAR_LEAD');
    expect(resultado.patch).toMatchObject({ estado: 'ABANDONADO', etapaAtual: null });
    expect(resultado.patch.abandonadoEm).toEqual(AGORA);
    expect(resultado.efeitos).toHaveLength(0);
  });

  it('ignora timeout de lembrete que não corresponde mais ao tipo pendente (corrida já resolvida)', () => {
    const resultado = processarEvento(
      base({
        leadMaisRecente: lead({ proximoTimeoutTipo: 'ABANDONO' }),
        evento: { tipo: 'TIMEOUT_LEMBRETE' },
      }),
    );
    expect(resultado.acao).toBe('NENHUMA_MUDANCA');
  });
});
