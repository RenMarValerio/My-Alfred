import {
  normalizarTexto,
  parseRespostaMenu,
  renderizarMenu,
  renderizarTemplate,
  textoValido,
} from './normalizacao.js';
import type {
  ConfiguracaoTriagem,
  Efeito,
  EntradaProcessamento,
  EtapaTriagem,
  LeadPatch,
  LeadSnapshot,
  ResultadoProcessamento,
  TipoTimeout,
  VendedorRef,
} from './tipos.js';

const MAX_TENTATIVAS_INVALIDAS = 2;

/** Data do próximo timeout a agendar, a partir de "agora" e da configuração vigente. */
function proximoTimeout(
  tipo: TipoTimeout,
  config: ConfiguracaoTriagem,
  agora: Date,
): { proximoTimeoutEm: Date; proximoTimeoutTipo: TipoTimeout } {
  const em = new Date(agora);
  if (tipo === 'LEMBRETE') {
    em.setMinutes(em.getMinutes() + config.timeoutLembreteMin);
  } else {
    em.setHours(em.getHours() + config.timeoutAbandonoH);
  }
  return { proximoTimeoutEm: em, proximoTimeoutTipo: tipo };
}

function rotuloOpcao(codigo: string | null, opcoes: { codigo: string; rotulo: string }[]): string {
  if (codigo == null) return '(não informado)';
  return opcoes.find((o) => o.codigo === codigo)?.rotulo ?? codigo;
}

function vendedorPorId(id: number | null, config: ConfiguracaoTriagem): VendedorRef | null {
  if (id == null) return null;
  return config.vendedores.find((v) => v.id === id) ?? null;
}

function formatarDataHora(data: Date): string {
  return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Monta o texto de notificação ao vendedor a partir dos dados disponíveis do lead. */
function montarResumoVendedor(
  telefone: string,
  dados: {
    nomeContato: string | null;
    segmentoCodigo: string | null;
    segmentoLivre: string | null;
    volumeCodigo: string | null;
    origem: string | null;
  },
  config: ConfiguracaoTriagem,
  agora: Date,
): string {
  const segmentoRotulo = rotuloOpcao(dados.segmentoCodigo, config.opcoesSegmento);
  const segmentoTexto = dados.segmentoLivre
    ? `${segmentoRotulo} — "${dados.segmentoLivre}"`
    : segmentoRotulo;

  return renderizarTemplate(config.textos.notificacao_vendedor ?? '', {
    telefone,
    nome: dados.nomeContato ?? '(não informado)',
    segmento: segmentoTexto,
    volume: rotuloOpcao(dados.volumeCodigo, config.opcoesVolume),
    origem: dados.origem ?? '(não disponível)',
    data_hora: formatarDataHora(agora),
  });
}

function encontrarVendedorRoteamento(
  segmentoCodigo: string,
  volumeCodigo: string,
  config: ConfiguracaoTriagem,
): VendedorRef {
  const regra = config.roteamento.find(
    (r) => r.segmentoCodigo === segmentoCodigo && r.volumeCodigo === volumeCodigo,
  );
  if (regra) {
    const vendedor = vendedorPorId(regra.vendedorId, config);
    if (vendedor) return vendedor;
  }
  return config.vendedorPadrao;
}

/** Mensagem + menu para a etapa informada — usado tanto na 1ª pergunta quanto no reenvio. */
function mensagemDaEtapa(etapa: EtapaTriagem, config: ConfiguracaoTriagem): string {
  switch (etapa) {
    case 'AGUARDANDO_SEGMENTO':
      return `${config.textos.pergunta_segmento_cabecalho ?? ''}\n${renderizarMenu(config.opcoesSegmento)}`;
    case 'AGUARDANDO_SEGMENTO_LIVRE':
      return config.textos.pergunta_segmento_livre ?? '';
    case 'AGUARDANDO_VOLUME':
      return `${config.textos.pergunta_volume_cabecalho ?? ''}\n${renderizarMenu(config.opcoesVolume)}`;
    case 'AGUARDANDO_NOME':
      return config.textos.pergunta_nome ?? '';
  }
}

/**
 * Encerra a triagem por 2 respostas inválidas seguidas na mesma pergunta: transfere ao vendedor
 * padrão com o resumo parcial (com os dados coletados até ali) e pede para anexar a
 * transcrição das mensagens do lead.
 */
function encerrarPorFalha(
  lead: LeadSnapshot,
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  const vendedor = config.vendedorPadrao;
  const resumo = montarResumoVendedor(
    lead.telefone,
    {
      nomeContato: lead.nomeContato,
      segmentoCodigo: lead.segmentoCodigo,
      segmentoLivre: lead.segmentoLivre,
      volumeCodigo: lead.volumeCodigo,
      origem: lead.origem,
    },
    config,
    agora,
  );

  const efeitos: Efeito[] = [
    {
      tipo: 'ENVIAR_AO_LEAD',
      texto: renderizarTemplate(config.textos.transferencia_lead ?? '', { vendedor: vendedor.nome }),
      tipoMensagem: 'TRANSFERENCIA',
    },
    {
      tipo: 'NOTIFICAR_VENDEDOR',
      vendedorId: vendedor.id,
      texto: resumo,
      tipoMensagem: 'NOTIFICACAO_VENDEDOR',
      incluirTranscricaoCompleta: true,
    },
  ];

  return {
    acao: 'ATUALIZAR_LEAD',
    leadId: lead.id,
    patch: {
      estado: 'TRANSFERIDO',
      etapaAtual: null,
      vendedorId: vendedor.id,
      proximoTimeoutEm: null,
      proximoTimeoutTipo: null,
      transferidoEm: agora,
    },
    efeitos,
  };
}

/** 1ª resposta inválida: reenvia a pergunta com o aviso de "não entendi"; 2ª: encerra por falha. */
function tratarRespostaInvalida(
  lead: LeadSnapshot,
  etapaAtual: EtapaTriagem,
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  if (lead.tentativasInvalidas + 1 >= MAX_TENTATIVAS_INVALIDAS) {
    return encerrarPorFalha(lead, config, agora);
  }

  const { proximoTimeoutEm, proximoTimeoutTipo } = proximoTimeout('LEMBRETE', config, agora);
  const textoReenvio = `${config.textos.nao_entendi ?? ''}\n${mensagemDaEtapa(etapaAtual, config)}`;

  return {
    acao: 'ATUALIZAR_LEAD',
    leadId: lead.id,
    patch: { tentativasInvalidas: lead.tentativasInvalidas + 1, proximoTimeoutEm, proximoTimeoutTipo },
    efeitos: [{ tipo: 'ENVIAR_AO_LEAD', texto: textoReenvio, tipoMensagem: 'INVALIDA' }],
  };
}

/** Avança para a próxima etapa com sucesso, zerando tentativas e reagendando o lembrete. */
function avancarEtapa(
  lead: LeadSnapshot,
  proximaEtapa: EtapaTriagem,
  patchExtra: LeadPatch,
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  const { proximoTimeoutEm, proximoTimeoutTipo } = proximoTimeout('LEMBRETE', config, agora);
  return {
    acao: 'ATUALIZAR_LEAD',
    leadId: lead.id,
    patch: {
      ...patchExtra,
      etapaAtual: proximaEtapa,
      tentativasInvalidas: 0,
      proximoTimeoutEm,
      proximoTimeoutTipo,
    },
    efeitos: [
      { tipo: 'ENVIAR_AO_LEAD', texto: mensagemDaEtapa(proximaEtapa, config), tipoMensagem: proximaEtapa },
    ],
  };
}

/** Conclui a triagem com sucesso: roteia, despede-se do lead pelo nome e notifica o vendedor. */
function concluirComSucesso(
  lead: LeadSnapshot,
  nomeContato: string,
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  if (lead.segmentoCodigo == null || lead.volumeCodigo == null) {
    // Guarda de tipo: a máquina só chega aqui depois de AGUARDANDO_VOLUME ter sido concluída.
    throw new Error('Estado inconsistente: segmento/volume ausentes ao concluir a triagem.');
  }

  const vendedor = encontrarVendedorRoteamento(lead.segmentoCodigo, lead.volumeCodigo, config);
  const resumo = montarResumoVendedor(
    lead.telefone,
    {
      nomeContato,
      segmentoCodigo: lead.segmentoCodigo,
      segmentoLivre: lead.segmentoLivre,
      volumeCodigo: lead.volumeCodigo,
      origem: lead.origem,
    },
    config,
    agora,
  );

  const efeitos: Efeito[] = [
    {
      tipo: 'ENVIAR_AO_LEAD',
      texto: renderizarTemplate(config.textos.transferencia_lead_personalizada ?? '', {
        nome: nomeContato,
        vendedor: vendedor.nome,
      }),
      tipoMensagem: 'TRANSFERENCIA',
    },
    {
      tipo: 'NOTIFICAR_VENDEDOR',
      vendedorId: vendedor.id,
      texto: resumo,
      tipoMensagem: 'NOTIFICACAO_VENDEDOR',
    },
  ];

  return {
    acao: 'ATUALIZAR_LEAD',
    leadId: lead.id,
    patch: {
      estado: 'TRANSFERIDO',
      etapaAtual: null,
      nomeContato,
      vendedorId: vendedor.id,
      proximoTimeoutEm: null,
      proximoTimeoutTipo: null,
      transferidoEm: agora,
    },
    efeitos,
  };
}

function criarLead(entrada: EntradaProcessamento): ResultadoProcessamento {
  const { config, agora, telefone } = entrada;
  const { proximoTimeoutEm, proximoTimeoutTipo } = proximoTimeout('LEMBRETE', config, agora);

  return {
    acao: 'CRIAR_LEAD',
    dadosNovoLead: {
      telefone,
      nomeWhatsapp: entrada.nomeWhatsappRecebido ?? null,
      origem: entrada.origemRecebida ?? null,
      leadAnteriorId: entrada.leadMaisRecente?.estado === 'ABANDONADO' ? entrada.leadMaisRecente.id : null,
    },
    patch: {
      estado: 'EM_TRIAGEM',
      etapaAtual: 'AGUARDANDO_SEGMENTO',
      tentativasInvalidas: 0,
      proximoTimeoutEm,
      proximoTimeoutTipo,
    },
    efeitos: [
      {
        tipo: 'ENVIAR_AO_LEAD',
        texto: `${config.textos.boas_vindas ?? ''}\n\n${mensagemDaEtapa('AGUARDANDO_SEGMENTO', config)}`,
        tipoMensagem: 'BOAS_VINDAS',
      },
    ],
  };
}

function processarMensagemEmTriagem(
  lead: LeadSnapshot,
  texto: string | null,
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  const etapa = lead.etapaAtual;
  if (etapa == null) {
    throw new Error(`Lead ${lead.id} está EM_TRIAGEM sem etapaAtual definida.`);
  }

  switch (etapa) {
    case 'AGUARDANDO_SEGMENTO': {
      const opcao = parseRespostaMenu(texto, config.opcoesSegmento);
      if (!opcao) return tratarRespostaInvalida(lead, etapa, config, agora);

      if (opcao.permiteTextoLivre) {
        return avancarEtapa(
          lead,
          'AGUARDANDO_SEGMENTO_LIVRE',
          { segmentoCodigo: opcao.codigo },
          config,
          agora,
        );
      }
      return avancarEtapa(lead, 'AGUARDANDO_VOLUME', { segmentoCodigo: opcao.codigo }, config, agora);
    }

    case 'AGUARDANDO_SEGMENTO_LIVRE': {
      if (!textoValido(texto)) return tratarRespostaInvalida(lead, etapa, config, agora);
      return avancarEtapa(lead, 'AGUARDANDO_VOLUME', { segmentoLivre: texto.trim() }, config, agora);
    }

    case 'AGUARDANDO_VOLUME': {
      const opcao = parseRespostaMenu(texto, config.opcoesVolume);
      if (!opcao) return tratarRespostaInvalida(lead, etapa, config, agora);
      return avancarEtapa(lead, 'AGUARDANDO_NOME', { volumeCodigo: opcao.codigo }, config, agora);
    }

    case 'AGUARDANDO_NOME': {
      if (!textoValido(texto)) return tratarRespostaInvalida(lead, etapa, config, agora);
      return concluirComSucesso(lead, texto.trim(), config, agora);
    }
  }
}

function processarTimeout(
  lead: LeadSnapshot,
  tipoTimeout: 'TIMEOUT_LEMBRETE' | 'TIMEOUT_ABANDONO',
  config: ConfiguracaoTriagem,
  agora: Date,
): ResultadoProcessamento {
  if (lead.proximoTimeoutTipo == null) return { acao: 'NENHUMA_MUDANCA' };

  if (tipoTimeout === 'TIMEOUT_LEMBRETE') {
    if (lead.proximoTimeoutTipo !== 'LEMBRETE') return { acao: 'NENHUMA_MUDANCA' };
    const { proximoTimeoutEm, proximoTimeoutTipo } = proximoTimeout('ABANDONO', config, agora);
    return {
      acao: 'ATUALIZAR_LEAD',
      leadId: lead.id,
      patch: { proximoTimeoutEm, proximoTimeoutTipo },
      efeitos: [{ tipo: 'ENVIAR_AO_LEAD', texto: config.textos.lembrete ?? '', tipoMensagem: 'LEMBRETE' }],
    };
  }

  // TIMEOUT_ABANDONO
  if (lead.proximoTimeoutTipo !== 'ABANDONO') return { acao: 'NENHUMA_MUDANCA' };
  return {
    acao: 'ATUALIZAR_LEAD',
    leadId: lead.id,
    patch: {
      estado: 'ABANDONADO',
      etapaAtual: null,
      proximoTimeoutEm: null,
      proximoTimeoutTipo: null,
      abandonadoEm: agora,
    },
    efeitos: [],
  };
}

/**
 * Função pura central do domínio: recebe o retrato atual (lead mais recente do telefone, se
 * houver) e um evento, e decide a transição — sem nenhum I/O. Toda regra de negócio (textos,
 * menus, roteamento, vendedor padrão, timeouts) vem de `entrada.config`, carregada do banco
 * pela camada de aplicação.
 */
export function processarEvento(entrada: EntradaProcessamento): ResultadoProcessamento {
  const { telefoneClienteExistente, leadMaisRecente, evento, config, agora } = entrada;

  if (telefoneClienteExistente) return { acao: 'IGNORAR' };

  if (leadMaisRecente == null) {
    if (evento.tipo !== 'MENSAGEM_RECEBIDA') return { acao: 'NENHUMA_MUDANCA' };
    return criarLead(entrada);
  }

  if (leadMaisRecente.estado === 'TRANSFERIDO') return { acao: 'IGNORAR' };

  if (leadMaisRecente.estado === 'ABANDONADO') {
    if (evento.tipo !== 'MENSAGEM_RECEBIDA') return { acao: 'NENHUMA_MUDANCA' };
    return criarLead(entrada);
  }

  // leadMaisRecente.estado === 'EM_TRIAGEM'
  switch (evento.tipo) {
    case 'MENSAGEM_RECEBIDA':
      return processarMensagemEmTriagem(leadMaisRecente, evento.texto, config, agora);
    case 'TIMEOUT_LEMBRETE':
      return processarTimeout(leadMaisRecente, 'TIMEOUT_LEMBRETE', config, agora);
    case 'TIMEOUT_ABANDONO':
      return processarTimeout(leadMaisRecente, 'TIMEOUT_ABANDONO', config, agora);
  }
}

export { normalizarTexto };
