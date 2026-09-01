import { prisma } from '../src/infraestrutura/persistencia/prisma/cliente.js';
import { seedVendedores } from './seed-vendedores.js';

/** Opções do menu de segmento (Estado 2) — "Outros" é a única com texto livre. */
const OPCOES_SEGMENTO = [
  { ordem: 1, codigo: 'DOCERIA', rotulo: 'Doceria' },
  { ordem: 2, codigo: 'DISTRIBUIDORA_BEBIDAS', rotulo: 'Distribuidora de Bebidas' },
  { ordem: 3, codigo: 'EMBALAGENS', rotulo: 'Venda de Embalagens' },
  { ordem: 4, codigo: 'MERCADO', rotulo: 'Mercado' },
  { ordem: 5, codigo: 'OUTROS', rotulo: 'Outros', permiteTextoLivre: true },
] as const;

/** Opções do menu de volume (Estado 3). */
const OPCOES_VOLUME = [
  { ordem: 1, codigo: 'UNIDADE', rotulo: 'Unidade' },
  { ordem: 2, codigo: 'CAIXA', rotulo: 'Caixa' },
  { ordem: 3, codigo: 'PALETE', rotulo: 'Palete' },
  { ordem: 4, codigo: 'CARGA', rotulo: 'Carga' },
] as const;

/**
 * Textos das mensagens — editáveis aqui (ou, futuramente, pela tela admin) sem tocar em código.
 * O texto do menu (1 - Doceria, 2 - ...) é renderizado em runtime a partir de OPCOES_SEGMENTO/
 * OPCOES_VOLUME — não faz parte destes templates.
 */
const TEXTOS: Record<string, { conteudo: string; descricao: string }> = {
  boas_vindas: {
    conteudo: 'Olá! Meu nome é Karen, assistente de atendimento da M2 Distribuição. 👋 Vou fazer duas perguntinhas rápidas para te direcionar ao vendedor certo.',
    descricao: 'Enviada na 1ª mensagem de um lead novo (ou reiniciando após 24h sem concluir).',
  },
  pergunta_segmento_cabecalho: {
    conteudo: 'Qual é o seu segmento? Responda com o número:',
    descricao: 'Cabeçalho da pergunta 1 — o menu numerado é gerado a partir das opções cadastradas.',
  },
  pergunta_segmento_livre: {
    conteudo: 'Jurídico! Me conta qual é o seu segmento?',
    descricao: 'Enviada só quando o lead escolhe "Outros" no segmento.',
  },
  pergunta_volume_cabecalho: {
    conteudo: 'E qual o volume médio das suas compras? Responda com o número:',
    descricao: 'Cabeçalho da pergunta 2 — o menu numerado é gerado a partir das opções cadastradas.',
  },
  pergunta_nome: {
    conteudo: 'Antes de te transferir, qual é o seu nome? 😊',
    descricao: 'Enviada depois do volume, antes do roteamento/transferência.',
  },
  nao_entendi: {
    conteudo: 'Não consegui identificar sua resposta. Posso responder só com o número da opção? 🙏',
    descricao: 'Precede o reenvio da pergunta na 1ª resposta inválida.',
  },
  lembrete: {
    conteudo: 'Ei! Ainda está por aí? É só responder com o número da opção que eu te direciono ao vendedor certo. 😊',
    descricao: 'Lembrete único, enviado pelo poller após o timeout de lembrete (padrão: 15min).',
  },
  transferencia_lead: {
    conteudo: 'Perfeito! Já estou te transferindo para o(a) {{vendedor}}, que vai cuidar do seu atendimento. 😊',
    descricao: 'Usada quando a triagem é encerrada por falha (2 respostas inválidas seguidas) — sem nome, pois a pergunta do nome não foi alcançada.',
  },
  transferencia_lead_personalizada: {
    conteudo: 'Perfeito, {{nome}}! Já estou te transferindo para o(a) {{vendedor}}, que vai cuidar do seu atendimento. 😊',
    descricao: 'Usada quando a triagem é concluída com sucesso (segmento, volume e nome informados).',
  },
  notificacao_vendedor: {
    conteudo:
      'Novo lead! 👋\nNome: {{nome}}\nTelefone: {{telefone}}\nSegmento: {{segmento}}\nVolume: {{volume}}\nOrigem: {{origem}}\nRecebido em: {{data_hora}}',
    descricao: 'Enviada ao vendedor (padrão ou roteado) junto com a transferência do lead.',
  },
};

function idObrigatorio(mapa: Record<string, number>, codigo: string): number {
  const id = mapa[codigo];
  if (id == null) throw new Error(`Vendedor de código "${codigo}" não encontrado no seed.`);
  return id;
}

export async function seedConfiguracao(): Promise<void> {
  const vendedores = await seedVendedores();

  for (const opcao of OPCOES_SEGMENTO) {
    await prisma.opcaoSegmento.upsert({
      where: { codigo: opcao.codigo },
      update: { ordem: opcao.ordem, rotulo: opcao.rotulo, permiteTextoLivre: 'permiteTextoLivre' in opcao ? opcao.permiteTextoLivre : false, ativo: true },
      create: {
        ordem: opcao.ordem,
        codigo: opcao.codigo,
        rotulo: opcao.rotulo,
        permiteTextoLivre: 'permiteTextoLivre' in opcao ? opcao.permiteTextoLivre : false,
      },
    });
  }

  for (const opcao of OPCOES_VOLUME) {
    await prisma.opcaoVolume.upsert({
      where: { codigo: opcao.codigo },
      update: { ordem: opcao.ordem, rotulo: opcao.rotulo, ativo: true },
      create: { ordem: opcao.ordem, codigo: opcao.codigo, rotulo: opcao.rotulo },
    });
  }

  for (const [chave, { conteudo, descricao }] of Object.entries(TEXTOS)) {
    await prisma.textoMensagem.upsert({
      where: { chave },
      update: { conteudo, descricao },
      create: { chave, conteudo, descricao },
    });
  }

  await prisma.configuracaoGeral.upsert({
    where: { id: 1 },
    update: { vendedorPadraoId: idObrigatorio(vendedores, 'PADRAO'), timeoutLembreteMin: 15, timeoutAbandonoH: 24 },
    create: {
      id: 1,
      vendedorPadraoId: idObrigatorio(vendedores, 'PADRAO'),
      timeoutLembreteMin: 15,
      timeoutAbandonoH: 24,
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedConfiguracao()
    .then(() => {
      console.log('Configuração, opções de menu e textos seedados.');
      return prisma.$disconnect();
    })
    .catch(async (erro) => {
      console.error(erro);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
