import type { GatewayWhatsapp } from '../../../aplicacao/portas/gateway-whatsapp.port.js';

export interface ConfiguracaoGatewayTwilio {
  accountSid: string;
  authToken: string;
  /** Número remetente no formato "whatsapp:+1415..." exigido pela API da Twilio. */
  numeroWhatsappRemetente: string;
}

/**
 * Esqueleto do adapter para a API do WhatsApp via Twilio — NÃO IMPLEMENTADO. Existe só para
 * fixar a assinatura da porta `GatewayWhatsapp` e documentar o que falta decidir/implementar
 * quando o provedor definitivo for escolhido (ver docs/arquitetura.md, seção "Itens em aberto").
 *
 * Pontos que dependem do provedor e ainda não foram resolvidos aqui:
 * - Autenticação: `accountSid`/`authToken` (ou API Key) via variáveis de ambiente, nunca
 *   hardcoded — a varredura inicial deste repositório encontrou uma credencial de sandbox da
 *   Twilio exposta em texto puro num arquivo versionado; não repetir esse erro.
 * - Sandbox vs. número de produção homologado (WhatsApp Business Profile aprovado pela Meta via
 *   Twilio) — o sandbox tem uma janela de teste e exige opt-in manual do destinatário.
 * - Formato do webhook de mensagens recebidas (`POST` com corpo `application/x-www-form-urlencoded`
 *   contendo `From`, `Body`, `ProfileName`, etc.) — o adapter de recebimento (não implementado
 *   ainda) precisa converter isso para `MensagemRecebida` antes de chamar
 *   `ProcessarMensagemRecebida.executar()`.
 * - Janela de 24h / mensagens de template aprovadas pela Meta para reabrir conversa fora da
 *   janela — relevante para o lembrete e para a notificação ao vendedor, se ultrapassar 24h.
 * - Como extrair a "origem do clique" (Click-to-WhatsApp Ads) — a Twilio repassa o payload de
 *   referral da Meta quando presente, mas o formato exato depende da configuração do anúncio.
 */
export class GatewayWhatsappTwilio implements GatewayWhatsapp {
  constructor(private readonly config: ConfiguracaoGatewayTwilio) {}

  async enviarMensagem(_telefoneDestino: string, _texto: string): Promise<void> {
    throw new Error(
      'GatewayWhatsappTwilio não implementado — provedor de WhatsApp real ainda não definido. ' +
        'Ver docs/arquitetura.md, seção "Itens em aberto".',
    );
  }
}
