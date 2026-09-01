/**
 * Tipos do domínio de triagem. Este módulo (e todo `src/domain/triagem`) não deve importar
 * nada de infraestrutura (Prisma, gateways de WhatsApp, relógio de sistema) — é o núcleo puro
 * da máquina de estados, testável sem I/O.
 */

export type EstadoLead = 'EM_TRIAGEM' | 'TRANSFERIDO' | 'ABANDONADO';

export type EtapaTriagem =
  | 'AGUARDANDO_SEGMENTO'
  | 'AGUARDANDO_SEGMENTO_LIVRE'
  | 'AGUARDANDO_VOLUME'
  | 'AGUARDANDO_NOME';

export type TipoTimeout = 'LEMBRETE' | 'ABANDONO';

/** Uma opção de menu numerado (segmento ou volume), como configurada no banco. */
export interface OpcaoMenu {
  ordem: number;
  codigo: string;
  rotulo: string;
  /** true somente para a opção "Outros" do segmento — dispara a pergunta de texto livre. */
  permiteTextoLivre?: boolean;
}

/** Uma linha da tabela de roteamento (segmento × volume → vendedor). */
export interface RegraRoteamento {
  segmentoCodigo: string;
  volumeCodigo: string;
  vendedorId: number;
}

export interface VendedorRef {
  id: number;
  nome: string;
  telefoneWhatsapp: string;
}

/** Tudo que o domínio precisa saber do banco para decidir uma transição — sem regra hardcoded. */
export interface ConfiguracaoTriagem {
  opcoesSegmento: OpcaoMenu[];
  opcoesVolume: OpcaoMenu[];
  roteamento: RegraRoteamento[];
  vendedorPadrao: VendedorRef;
  vendedores: VendedorRef[];
  timeoutLembreteMin: number;
  timeoutAbandonoH: number;
  /** Templates de texto por chave (ex.: "boas_vindas", "pergunta_segmento_cabecalho"...). */
  textos: Record<string, string>;
}

/** Retrato do lead mais recente para um telefone, como persistido em `Lead`. */
export interface LeadSnapshot {
  id: number;
  telefone: string;
  nomeWhatsapp: string | null;
  origem: string | null;
  estado: EstadoLead;
  etapaAtual: EtapaTriagem | null;
  segmentoCodigo: string | null;
  segmentoLivre: string | null;
  volumeCodigo: string | null;
  nomeContato: string | null;
  vendedorId: number | null;
  tentativasInvalidas: number;
  proximoTimeoutEm: Date | null;
  proximoTimeoutTipo: TipoTimeout | null;
}

export type Evento =
  | { tipo: 'MENSAGEM_RECEBIDA'; texto: string | null }
  | { tipo: 'TIMEOUT_LEMBRETE' }
  | { tipo: 'TIMEOUT_ABANDONO' };

/** Dados de entrada do caso de uso — o que a aplicação já resolveu via repositórios. */
export interface EntradaProcessamento {
  /** Telefone (E.164) a que este evento se refere — sempre conhecido pela aplicação. */
  telefone: string;
  /** true se o telefone está na allowlist de clientes já em atendimento — bot nunca responde. */
  telefoneClienteExistente: boolean;
  /** Lead mais recente para este telefone (qualquer estado), ou null se nunca houve um. */
  leadMaisRecente: LeadSnapshot | null;
  evento: Evento;
  config: ConfiguracaoTriagem;
  agora: Date;
  /** Só usados ao criar um lead novo, a partir de metadados da mensagem recebida. */
  nomeWhatsappRecebido?: string | null;
  origemRecebida?: string | null;
}

export interface DadosNovoLead {
  telefone: string;
  nomeWhatsapp: string | null;
  origem: string | null;
  leadAnteriorId: number | null;
}

/** Conjunto de campos a gravar/atualizar na linha do lead — undefined = não mexe no campo. */
export interface LeadPatch {
  estado?: EstadoLead;
  etapaAtual?: EtapaTriagem | null;
  segmentoCodigo?: string | null;
  segmentoLivre?: string | null;
  volumeCodigo?: string | null;
  nomeContato?: string | null;
  vendedorId?: number | null;
  tentativasInvalidas?: number;
  proximoTimeoutEm?: Date | null;
  proximoTimeoutTipo?: TipoTimeout | null;
  transferidoEm?: Date | null;
  abandonadoEm?: Date | null;
}

export type Efeito =
  | { tipo: 'ENVIAR_AO_LEAD'; texto: string; tipoMensagem: string }
  | {
      tipo: 'NOTIFICAR_VENDEDOR';
      vendedorId: number;
      texto: string;
      tipoMensagem: string;
      /**
       * Quando true, a aplicação deve anexar ao texto a transcrição das mensagens que o lead
       * escreveu durante a triagem (o domínio não tem acesso ao histórico de `Mensagem`).
       */
      incluirTranscricaoCompleta?: boolean;
    };

export type ResultadoProcessamento =
  | { acao: 'IGNORAR' }
  | { acao: 'CRIAR_LEAD'; dadosNovoLead: DadosNovoLead; patch: LeadPatch; efeitos: Efeito[] }
  | { acao: 'ATUALIZAR_LEAD'; leadId: number; patch: LeadPatch; efeitos: Efeito[] }
  | { acao: 'NENHUMA_MUDANCA' };
