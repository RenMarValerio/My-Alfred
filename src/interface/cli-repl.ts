#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import { ExecutarPollerTimeouts } from '../aplicacao/executar-poller-timeouts.js';
import { ProcessarMensagemRecebida } from '../aplicacao/processar-mensagem-recebida.js';
import { prisma } from '../infraestrutura/persistencia/prisma/cliente.js';
import { RepositorioConfiguracaoPrisma } from '../infraestrutura/persistencia/prisma/repositorio-configuracao.prisma.js';
import { RepositorioLeadsPrisma } from '../infraestrutura/persistencia/prisma/repositorio-leads.prisma.js';
import { RelogioControlavel } from '../infraestrutura/relogio/relogio-controlavel.js';
import { GatewayWhatsappSimulado } from '../infraestrutura/whatsapp/gateway-simulado.js';

const TELEFONE_PADRAO = '+5511999990000';

/**
 * REPL de simulação de conversa — transporte simulado (sem WhatsApp real), como pedido para a
 * primeira etapa testável. Usa o banco real (via DATABASE_URL do .env) e um relógio controlável,
 * para permitir também simular os timeouts de lembrete/abandono sem esperar tempo real.
 *
 * Lê todas as linhas por um único `for await...of rl` (a primeira é o telefone, as seguintes são
 * comandos/mensagens) em vez de misturar `rl.question()` com o iterador assíncrono — as duas
 * formas não se combinam de forma confiável no `readline/promises` do Node quando o stdin não é
 * um terminal interativo (ex.: entrada via pipe/arquivo, como em testes automatizados desta CLI):
 * linhas ficam perdidas entre uma forma e outra. Um único iterador evita o problema e funciona
 * igual em uso interativo.
 */
async function main() {
  const relogio = new RelogioControlavel(new Date());
  const gateway = new GatewayWhatsappSimulado((msg) => {
    console.log(`\n📨 Karen -> ${msg.telefoneDestino}:\n${msg.texto}\n`);
  });
  const repositorioLeads = new RepositorioLeadsPrisma();
  const repositorioConfiguracao = new RepositorioConfiguracaoPrisma();
  const processar = new ProcessarMensagemRecebida(
    repositorioLeads,
    repositorioConfiguracao,
    gateway,
    relogio,
  );
  const poller = new ExecutarPollerTimeouts(repositorioLeads, repositorioConfiguracao, gateway, relogio);

  const rl = readline.createInterface({ input: stdin, output: stdout });

  let telefone: string | null = null;
  stdout.write('Telefone do lead simulado (Enter para +5511999990000): ');

  for await (const linha of rl) {
    if (telefone == null) {
      telefone = linha.trim().length > 0 ? linha.trim() : TELEFONE_PADRAO;
      console.log(`\nSimulação iniciada para ${telefone}.`);
      console.log(
        'Comandos: /avancar 20m | /avancar 25h | /poll | /sair — qualquer outro texto é enviado',
        'como mensagem do lead (Enter vazio simula mensagem sem texto, ex.: figurinha).\n',
      );
      stdout.write('> ');
      continue;
    }

    if (linha === '/sair') break;

    if (linha.startsWith('/avancar')) {
      const match = linha.match(/(\d+)\s*(m|h)/);
      if (!match) {
        console.log('Uso: /avancar 20m   ou   /avancar 25h');
      } else {
        const valor = Number(match[1]);
        if (match[2] === 'm') relogio.avancar({ minutos: valor });
        else relogio.avancar({ horas: valor });
        console.log(`Relógio avançado. Agora: ${relogio.agora().toISOString()}`);
      }
    } else if (linha === '/poll') {
      const quantos = await poller.executar();
      console.log(`Poller executado. Leads processados: ${quantos}.`);
    } else {
      await processar.executar({ telefone, texto: linha.length > 0 ? linha : null });
    }

    stdout.write('> ');
  }

  rl.close();
  await prisma.$disconnect();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
