import type { GatewayWhatsapp } from '../../aplicacao/portas/gateway-whatsapp.port.js';

export interface MensagemSimuladaEnviada {
  telefoneDestino: string;
  texto: string;
  enviadaEm: Date;
}

/**
 * Implementação em memória da porta de WhatsApp — usada em testes de integração e no REPL de
 * simulação (Etapa 3). Não faz nenhuma chamada de rede; só guarda as mensagens enviadas para
 * inspeção e opcionalmente as imprime no console (útil no REPL).
 */
export class GatewayWhatsappSimulado implements GatewayWhatsapp {
  readonly mensagensEnviadas: MensagemSimuladaEnviada[] = [];

  constructor(private readonly aoEnviar?: (msg: MensagemSimuladaEnviada) => void) {}

  async enviarMensagem(telefoneDestino: string, texto: string): Promise<void> {
    const mensagem: MensagemSimuladaEnviada = { telefoneDestino, texto, enviadaEm: new Date() };
    this.mensagensEnviadas.push(mensagem);
    this.aoEnviar?.(mensagem);
  }

  mensagensPara(telefone: string): MensagemSimuladaEnviada[] {
    return this.mensagensEnviadas.filter((m) => m.telefoneDestino === telefone);
  }

  limpar(): void {
    this.mensagensEnviadas.length = 0;
  }
}
