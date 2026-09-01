import { PrismaClient } from '@prisma/client';

/**
 * Instância única do Prisma Client para todo o processo. Reaproveitada por todos os
 * repositórios concretos desta pasta.
 */
export const prisma = new PrismaClient();
