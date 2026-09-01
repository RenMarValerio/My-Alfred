import { aplicarResultadoTriagem } from './aplicar-resultado-triagem.js';
import { processarEvento } from '../domain/triagem/maquina-estados.js';
import type { GatewayWhatsapp } from './portas/gateway-whatsapp.port.js';
import type { Relogio } from './portas/relogio.port.js';
import type { RepositorioConfiguracao } from './portas/repositorio-configuracao.port.js';
import type { RepositorioLeads } from './portas/repositorio-leads.port.js';

/**
 * Caso de uso do poller: varre os leads `EM_TRIAGEM` com timeout vencido e reaproveita a mesma
 * máquina de estados para decidir o efeito (lembrete único, ou marcar como abandonado). Não há
 * nenhum `setTimeout` de negócio em lugar nenhum do sistema — a única fonte de verdade é a
 * coluna `proximoTimeoutEm` no banco, por isso um restart do processo nunca perde um timeout
 * pendente: na próxima execução do poller, ele simplesmente aparece na consulta.
 */
export class ExecutarPollerTimeouts {
  constructor(
    private readonly repositorioLeads: RepositorioLeads,
    private readonly repositorioConfiguracao: RepositorioConfiguracao,
    private readonly gatewayWhatsapp: GatewayWhatsapp,
    private readonly relogio: Relogio,
  ) {}

  /** Processa até `limite` leads vencidos numa passada; retorna quantos foram processados. */
  async executar(limite = 100): Promise<number> {
    const agora = this.relogio.agora();
    const config = await this.repositorioConfiguracao.carregarConfiguracaoTriagem();
    const leadsVencidos = await this.repositorioLeads.buscarComTimeoutVencido(agora, limite);

    for (const lead of leadsVencidos) {
      const resultado = processarEvento({
        telefone: lead.telefone,
        // buscarComTimeoutVencido só retorna leads EM_TRIAGEM, que por definição não são
        // clientes já existentes nem estão na allowlist — nunca teriam chegado a esse estado.
        telefoneClienteExistente: false,
        leadMaisRecente: lead,
        evento: { tipo: lead.proximoTimeoutTipo === 'LEMBRETE' ? 'TIMEOUT_LEMBRETE' : 'TIMEOUT_ABANDONO' },
        config,
        agora,
      });

      await aplicarResultadoTriagem(
        { repositorioLeads: this.repositorioLeads, gatewayWhatsapp: this.gatewayWhatsapp },
        lead.telefone,
        resultado,
        config,
      );
    }

    return leadsVencidos.length;
  }
}
