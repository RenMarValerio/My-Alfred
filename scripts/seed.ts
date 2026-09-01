import { prisma } from '../src/infraestrutura/persistencia/prisma/cliente.js';
import { seedConfiguracao } from './seed-configuracao.js';
import { seedRoteamento } from './seed-roteamento.js';
import { seedVendedores } from './seed-vendedores.js';

/** Orquestra os seeds na ordem correta: vendedores → configuração/opções/textos → roteamento. */
async function seedTudo(): Promise<void> {
  await seedVendedores();
  await seedConfiguracao();
  await seedRoteamento();
}

seedTudo()
  .then(() => {
    console.log('Seed completo: vendedores, opções de menu, textos, configuração e roteamento.');
    return prisma.$disconnect();
  })
  .catch(async (erro) => {
    console.error(erro);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
