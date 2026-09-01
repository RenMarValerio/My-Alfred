import type { Relogio } from '../../aplicacao/portas/relogio.port.js';

/** Relógio de produção — simplesmente `new Date()`. */
export class RelogioSistema implements Relogio {
  agora(): Date {
    return new Date();
  }
}
