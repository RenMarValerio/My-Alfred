#!/usr/bin/env node
import { ExecutarPollerTimeouts } from '../aplicacao/executar-poller-timeouts.js';
import { prisma } from '../infraestrutura/persistencia/prisma/cliente.js';
import { RepositorioConfiguracaoPrisma } from '../infraestrutura/persistencia/prisma/repositorio-configuracao.prisma.js';
import { RepositorioLeadsPrisma } from '../infraestrutura/persistencia/prisma/repositorio-leads.prisma.js';
import { RelogioSistema } from '../infraestrutura/relogio/relogio-sistema.js';
import { GatewayWhatsappSimulado } from '../infraestrutura/whatsapp/gateway-simulado.js';

/**
 * Processo que executa o poller de timeouts em loop. O `setInterval` aqui é só o gatilho
 * técnico — não é um timer de negócio: se o processo reiniciar, o próximo tick simplesmente
 * relê `proximoTimeoutEm` do banco e retoma de onde parou, sem perder nenhum timeout pendente.
 *
 * Usa o gateway simulado até o adapter de WhatsApp real ser conectado (Etapa 6) — trocar aqui
 * é a única mudança necessária quando o provedor for escolhido.
 */
const INTERVALO_MS = Number(process.env.POLLER_INTERVALO_MS ?? 30_000);

async function main() {
  const poller = new ExecutarPollerTimeouts(
    new RepositorioLeadsPrisma(),
    new RepositorioConfiguracaoPrisma(),
    new GatewayWhatsappSimulado((msg) => console.log(`📨 Karen -> ${msg.telefoneDestino}: ${msg.texto}`)),
    new RelogioSistema(),
  );

  console.log(`Worker do poller iniciado (intervalo: ${INTERVALO_MS}ms).`);

  const executarUmCiclo = async () => {
    try {
      const processados = await poller.executar();
      if (processados > 0) console.log(`Poller: ${processados} lead(s) processado(s).`);
    } catch (erro) {
      console.error('Erro ao executar o poller:', erro);
    }
  };

  await executarUmCiclo();
  const intervalo = setInterval(executarUmCiclo, INTERVALO_MS);

  const encerrar = async () => {
    clearInterval(intervalo);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
