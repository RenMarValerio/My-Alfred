import { aplicarResultadoTriagem } from './aplicar-resultado-triagem.js';
import { processarEvento } from '../domain/triagem/maquina-estados.js';
import type { EntradaProcessamento } from '../domain/triagem/tipos.js';
import type { GatewayWhatsapp } from './portas/gateway-whatsapp.port.js';
import type { Relogio } from './portas/relogio.port.js';
import type { RepositorioConfiguracao } from './portas/repositorio-configuracao.port.js';
import type { RepositorioLeads } from './portas/repositorio-leads.port.js';

/** Identificador simbólico da Karen nos registros de `Mensagem` (não é um telefone real). */
const REMETENTE_BOT = 'KAREN';

export interface MensagemRecebida {
  telefone: string;
  /** null quando a mensagem não tem texto (áudio, figurinha, imagem sem legenda...). */
  texto: string | null;
  nomeWhatsapp?: string | null;
  origem?: string | null;
}

/**
 * Caso de uso: recebe uma mensagem (do transporte simulado ou, futuramente, de um webhook real),
 * delega a decisão à máquina de estados pura e aplica o resultado (persistência + envio de
 * mensagens) através das portas injetadas. Não conhece nenhum provedor de WhatsApp específico.
 */
export class ProcessarMensagemRecebida {
  constructor(
    private readonly repositorioLeads: RepositorioLeads,
    private readonly repositorioConfiguracao: RepositorioConfiguracao,
    private readonly gatewayWhatsapp: GatewayWhatsapp,
    private readonly relogio: Relogio,
  ) {}

  async executar(mensagem: MensagemRecebida): Promise<void> {
    const agora = this.relogio.agora();
    const config = await this.repositorioConfiguracao.carregarConfiguracaoTriagem();
    const telefoneClienteExistente = await this.repositorioLeads.telefoneEhClienteExistente(
      mensagem.telefone,
    );

    let leadMaisRecente = await this.repositorioLeads.buscarMaisRecentePorTelefone(mensagem.telefone);

    // Corrida poller-vs-mensagem: se o timeout de abandono já venceu mas o poller ainda não
    // passou por este lead, fecha o ciclo antigo primeiro (idempotente) antes de tratar a nova
    // mensagem — assim ela sempre inicia um novo ciclo de triagem, nunca reaproveita um estado
    // que já deveria estar abandonado.
    if (
      leadMaisRecente?.estado === 'EM_TRIAGEM' &&
      leadMaisRecente.proximoTimeoutTipo === 'ABANDONO' &&
      leadMaisRecente.proximoTimeoutEm != null &&
      leadMaisRecente.proximoTimeoutEm <= agora
    ) {
      const resultadoAbandono = processarEvento({
        telefone: mensagem.telefone,
        telefoneClienteExistente,
        leadMaisRecente,
        evento: { tipo: 'TIMEOUT_ABANDONO' },
        config,
        agora,
      });
      await aplicarResultadoTriagem(
        { repositorioLeads: this.repositorioLeads, gatewayWhatsapp: this.gatewayWhatsapp },
        mensagem.telefone,
        resultadoAbandono,
        config,
      );
      leadMaisRecente = await this.repositorioLeads.buscarMaisRecentePorTelefone(mensagem.telefone);
    }

    const entrada: EntradaProcessamento = {
      telefone: mensagem.telefone,
      telefoneClienteExistente,
      leadMaisRecente,
      evento: { tipo: 'MENSAGEM_RECEBIDA', texto: mensagem.texto },
      config,
      agora,
      nomeWhatsappRecebido: mensagem.nomeWhatsapp ?? null,
      origemRecebida: mensagem.origem ?? null,
    };

    const resultado = processarEvento(entrada);

    // Registra a mensagem de entrada ANTES de despachar os efeitos: se o resultado for um
    // encerramento por falha (2ª resposta inválida), a transcrição enviada ao vendedor precisa
    // incluir esta última mensagem do lead. Para um lead recém-criado isso não se aplica — o id
    // só existe depois de `criar()`, e a própria primeira mensagem nunca é, sozinha, uma falha
    // por tentativas (ver `aplicarResultadoTriagem`/`criarLead` no domínio).
    if (resultado.acao === 'ATUALIZAR_LEAD') {
      await this.repositorioLeads.registrarMensagem(resultado.leadId, {
        direcao: 'ENTRADA',
        telefoneRemetente: mensagem.telefone,
        telefoneDestinatario: REMETENTE_BOT,
        texto: mensagem.texto ?? '(mensagem sem texto — mídia/figurinha)',
      });
    }

    const leadId = await aplicarResultadoTriagem(
      { repositorioLeads: this.repositorioLeads, gatewayWhatsapp: this.gatewayWhatsapp },
      mensagem.telefone,
      resultado,
      config,
    );

    if (resultado.acao === 'CRIAR_LEAD' && leadId != null) {
      await this.repositorioLeads.registrarMensagem(leadId, {
        direcao: 'ENTRADA',
        telefoneRemetente: mensagem.telefone,
        telefoneDestinatario: REMETENTE_BOT,
        texto: mensagem.texto ?? '(mensagem sem texto — mídia/figurinha)',
      });
    }
  }
}
