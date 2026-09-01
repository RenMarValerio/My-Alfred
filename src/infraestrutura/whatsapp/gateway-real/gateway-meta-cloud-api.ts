import type { GatewayWhatsapp } from '../../../aplicacao/portas/gateway-whatsapp.port.js';

export interface ConfiguracaoGatewayMetaCloudApi {
  /** Token de acesso permanente (System User) do WhatsApp Business Platform. */
  tokenAcesso: string;
  /** Id do número de telefone (Phone Number ID) cadastrado no Meta Business. */
  idNumeroTelefone: string;
  /** Versão da Graph API usada (ex.: "v21.0"). */
  versaoApi: string;
}

/**
 * Esqueleto do adapter para a WhatsApp Cloud API oficial da Meta — NÃO IMPLEMENTADO. Existe só
 * para fixar a assinatura da porta `GatewayWhatsapp` e documentar o que falta decidir/implementar
 * quando o provedor definitivo for escolhido (ver docs/arquitetura.md, seção "Itens em aberto").
 *
 * Pontos que dependem do provedor e ainda não foram resolvidos aqui:
 * - Autenticação via token de acesso de um System User do Meta Business — variável de ambiente,
 *   nunca hardcoded.
 * - Número de WhatsApp Business homologado (verificação do perfil comercial pela Meta).
 * - Formato do webhook de mensagens recebidas (payload JSON da Graph API, com verificação de
 *   assinatura via `X-Hub-Signature-256`) — o adapter de recebimento (não implementado ainda)
 *   precisa validar a assinatura e converter o payload para `MensagemRecebida`.
 * - Janela de 24h / "message templates" pré-aprovados pela Meta para reabrir conversa fora da
 *   janela — relevante para o lembrete e para a notificação ao vendedor, se ultrapassar 24h.
 * - Como extrair a "origem do clique": Click-to-WhatsApp Ads da Meta inclui um objeto
 *   `referral` (com `source_id`, `source_url`, `ctwa_clid`) na mensagem recebida quando o lead
 *   veio de um anúncio rastreável — é a fonte mais confiável de `origem` neste provedor.
 */
export class GatewayWhatsappMetaCloudApi implements GatewayWhatsapp {
  constructor(private readonly config: ConfiguracaoGatewayMetaCloudApi) {}

  async enviarMensagem(_telefoneDestino: string, _texto: string): Promise<void> {
    throw new Error(
      'GatewayWhatsappMetaCloudApi não implementado — provedor de WhatsApp real ainda não ' +
        'definido. Ver docs/arquitetura.md, seção "Itens em aberto".',
    );
  }
}
