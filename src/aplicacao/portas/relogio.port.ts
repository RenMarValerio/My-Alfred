/** Porta do relógio — nunca usar `setTimeout`/`Date.now()` direto fora daqui. */
export interface Relogio {
  agora(): Date;
}
