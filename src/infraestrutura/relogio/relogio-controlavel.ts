import type { Relogio } from '../../aplicacao/portas/relogio.port.js';

/**
 * Relógio para testes/REPL: mantém uma data mutável que só avança quando mandamos.
 * Não é um mock de `setTimeout` — é a própria porta `Relogio` usada em produção, só que
 * controlada manualmente. Permite testar os timeouts de 15min/24h sem esperar tempo real.
 */
export class RelogioControlavel implements Relogio {
  private atual: Date;

  constructor(inicial: Date) {
    this.atual = inicial;
  }

  agora(): Date {
    return this.atual;
  }

  avancar(quantidade: { minutos?: number; horas?: number }): void {
    const nova = new Date(this.atual);
    if (quantidade.minutos) nova.setMinutes(nova.getMinutes() + quantidade.minutos);
    if (quantidade.horas) nova.setHours(nova.getHours() + quantidade.horas);
    this.atual = nova;
  }

  definir(data: Date): void {
    this.atual = data;
  }
}
