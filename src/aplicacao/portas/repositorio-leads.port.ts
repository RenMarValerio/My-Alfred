import type { DadosNovoLead, LeadPatch, LeadSnapshot } from '../../domain/triagem/tipos.js';

export interface MensagemRegistrada {
  direcao: 'ENTRADA' | 'SAIDA';
  texto: string;
  tipo: string | null;
  criadoEm: Date;
}

export interface RepositorioLeads {
  /** true se o telefone estiver na allowlist de clientes já em atendimento. */
  telefoneEhClienteExistente(telefone: string): Promise<boolean>;

  /** Lead mais recente para o telefone, em qualquer estado — ou null se nunca houve nenhum. */
  buscarMaisRecentePorTelefone(telefone: string): Promise<LeadSnapshot | null>;

  /** Cria a linha do lead (novo ciclo de triagem) já com o patch inicial aplicado. */
  criar(dados: DadosNovoLead, patch: LeadPatch): Promise<LeadSnapshot>;

  /** Aplica o patch a um lead existente e retorna o retrato atualizado. */
  atualizar(leadId: number, patch: LeadPatch): Promise<LeadSnapshot>;

  /** Registra uma mensagem trocada (entrada do lead ou saída do bot/vendedor) no histórico. */
  registrarMensagem(
    leadId: number,
    mensagem: {
      direcao: 'ENTRADA' | 'SAIDA';
      telefoneRemetente: string;
      telefoneDestinatario: string;
      texto: string;
      tipo?: string;
    },
  ): Promise<void>;

  /** Transcrição completa (ordem cronológica) das mensagens de um lead — usada no resumo ao vendedor. */
  listarMensagens(leadId: number): Promise<MensagemRegistrada[]>;

  /**
   * Leads `EM_TRIAGEM` com `proximoTimeoutEm <= agora` — consultados pelo poller. `limite`
   * evita varrer a tabela inteira de uma vez em caso de acúmulo incomum.
   */
  buscarComTimeoutVencido(agora: Date, limite?: number): Promise<LeadSnapshot[]>;
}
