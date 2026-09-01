import type { OpcaoMenu } from './tipos.js';

// Intervalo Unicode de marcas diacríticas combinantes (U+0300–U+036F), usado para remover
// acentos após normalize('NFD').
const DIACRITICOS = /[̀-ͯ]/g;

/** Remove acentuação, baixa a caixa e remove espaços nas pontas. */
export function normalizarTexto(valor: string): string {
  return valor.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim();
}

/** true quando o texto tem conteúdo real (não é vazio, nem só espaço, nem ausente/mídia). */
export function textoValido(texto: string | null | undefined): texto is string {
  return texto != null && texto.trim().length > 0;
}

/**
 * Tenta casar a resposta do lead com uma opção do menu numerado.
 * Aceita "1", "1.", "1 -", "1)" (ou qualquer separador após o número) e também o texto exato
 * do rótulo da opção, normalizado (sem acento/caixa).
 */
export function parseRespostaMenu(texto: string | null, opcoes: OpcaoMenu[]): OpcaoMenu | null {
  if (!textoValido(texto)) return null;
  const normalizado = normalizarTexto(texto);
  if (normalizado.length === 0) return null;

  const matchNumero = normalizado.match(/^(\d+)/);
  if (matchNumero) {
    const numero = Number(matchNumero[1]);
    const porOrdem = opcoes.find((o) => o.ordem === numero);
    if (porOrdem) return porOrdem;
  }

  const porRotulo = opcoes.find((o) => normalizarTexto(o.rotulo) === normalizado);
  return porRotulo ?? null;
}

/** Substitui placeholders `{{chave}}` pelo valor correspondente em `dados` (string vazia se ausente). */
export function renderizarTemplate(template: string, dados: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, chave: string) => dados[chave] ?? '');
}

/** Renderiza o menu numerado ("1 - Doceria\n2 - ..."), na ordem configurada. */
export function renderizarMenu(opcoes: OpcaoMenu[]): string {
  return [...opcoes]
    .sort((a, b) => a.ordem - b.ordem)
    .map((o) => `${o.ordem} - ${o.rotulo}`)
    .join('\n');
}
