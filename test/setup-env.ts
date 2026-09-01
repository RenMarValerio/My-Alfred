// Carregado antes de qualquer teste (ver vitest.config.ts `setupFiles`): garante que os testes
// automatizados nunca tocam o banco de dev (`karen`), só o banco de teste (`karen_test`).
process.env.DATABASE_URL ??= 'postgresql://karen:karen@localhost:5432/karen_test?schema=public';
