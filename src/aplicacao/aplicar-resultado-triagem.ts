import type { ConfiguracaoTriagem, Efeito, ResultadoProcessamento } from '../domain/triagem/tipos.js';
import type { GatewayWhatsapp } from './portas/gateway-whatsapp.port.js';
import type { RepositorioLeads } from './portas/repositorio-leads.port.js';

/** Identificador simbólico da Karen nos registros de `Mensagem` (não é um telefone real). */
const REMETENTE_BOT = 'KAREN';

export interface DependenciasAplicacaoResultado {
  repositorioLeads: RepositorioLeads;
  gatewayWhatsapp: GatewayWhatsapp;
}

/**
 * Persiste a decisão do domínio (patch no lead, ou criação de um novo) e despacha os efeitos
 * (envio de mensagens ao lead e/ou ao vendedor). Compartilhado entre `ProcessarMensagemRecebida`
 * e `ExecutarPollerTimeouts` — ambos chamam `processarEvento()` e precisam aplicar o resultado
 * exatamente da mesma forma. Retorna o id do lead afetado, ou null se nada mudou.
 */
export async function aplicarResultadoTriagem(
  deps: DependenciasAplicacaoResultado,
  telefoneLead: string,
  resultado: ResultadoProcessamento,
  config: ConfiguracaoTriagem,
): Promise<number | null> {
  switch (resultado.acao) {
    case 'IGNORAR':
    case 'NENHUMA_MUDANCA':
      return null;

    case 'CRIAR_LEAD': {
      const lead = await deps.repositorioLeads.criar(resultado.dadosNovoLead, resultado.patch);
      await despacharEfeitos(deps, lead.id, telefoneLead, resultado.efeitos, config);
      return lead.id;
    }

    case 'ATUALIZAR_LEAD': {
      await deps.repositorioLeads.atualizar(resultado.leadId, resultado.patch);
      await despacharEfeitos(deps, resultado.leadId, telefoneLead, resultado.efeitos, config);
      return resultado.leadId;
    }
  }
}

async function despacharEfeitos(
  deps: DependenciasAplicacaoResultado,
  leadId: number,
  telefoneLead: string,
  efeitos: Efeito[],
  config: ConfiguracaoTriagem,
): Promise<void> {
  for (const efeito of efeitos) {
    if (efeito.tipo === 'ENVIAR_AO_LEAD') {
      await deps.gatewayWhatsapp.enviarMensagem(telefoneLead, efeito.texto);
      await deps.repositorioLeads.registrarMensagem(leadId, {
        direcao: 'SAIDA',
        telefoneRemetente: REMETENTE_BOT,
        telefoneDestinatario: telefoneLead,
        texto: efeito.texto,
        tipo: efeito.tipoMensagem,
      });
      continue;
    }

    // NOTIFICAR_VENDEDOR
    const vendedor = config.vendedores.find((v) => v.id === efeito.vendedorId);
    if (!vendedor) {
      throw new Error(`Vendedor id=${efeito.vendedorId} não encontrado na configuração carregada.`);
    }

    let texto = efeito.texto;
    if (efeito.incluirTranscricaoCompleta) {
      const mensagens = await deps.repositorioLeads.listarMensagens(leadId);
      const escritasPeloLead = mensagens.filter((m) => m.direcao === 'ENTRADA');
      if (escritasPeloLead.length > 0) {
        const transcricao = escritasPeloLead.map((m) => `- ${m.texto}`).join('\n');
        texto = `${texto}\n\nMensagens do lead durante a triagem:\n${transcricao}`;
      }
    }

    await deps.gatewayWhatsapp.enviarMensagem(vendedor.telefoneWhatsapp, texto);
    await deps.repositorioLeads.registrarMensagem(leadId, {
      direcao: 'SAIDA',
      telefoneRemetente: REMETENTE_BOT,
      telefoneDestinatario: vendedor.telefoneWhatsapp,
      texto,
      tipo: efeito.tipoMensagem,
    });
  }
}
