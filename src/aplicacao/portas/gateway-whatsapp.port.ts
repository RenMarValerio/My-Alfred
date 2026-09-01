/**
 * Porta de saída para o provedor de WhatsApp. O domínio nunca depende disto diretamente —
 * só a camada de aplicação, que injeta a implementação concreta (simulada em testes/REPL,
 * ou o adapter real quando o provedor for escolhido).
 */
export interface GatewayWhatsapp {
  enviarMensagem(telefoneDestino: string, texto: string): Promise<void>;
}
