import type { ConfiguracaoTriagem } from '../../domain/triagem/tipos.js';

/**
 * Carrega tudo que o domínio precisa do banco para decidir uma transição: opções de menu,
 * roteamento, vendedor padrão, timeouts e textos de mensagem. Uma única leitura por evento
 * processado é suficiente — nenhum desses dados muda no meio do processamento de um evento.
 */
export interface RepositorioConfiguracao {
  carregarConfiguracaoTriagem(): Promise<ConfiguracaoTriagem>;
}
