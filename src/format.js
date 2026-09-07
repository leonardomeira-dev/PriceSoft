/** Formatação em português do Brasil, compartilhada pela interface e pelos gráficos. */

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const currencyCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const percentShort = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** Valor monetário, protegido contra resultados não finitos. */
export const money = (value) => (Number.isFinite(value) ? currency.format(value) : '—');

/**
 * Exigências e faltas, arredondadas para cima.
 *
 * Os valores aparecem sem centavos. Arredondar um requisito para o mais próximo
 * o deixa abaixo do necessário quase metade das vezes — quem digitasse de volta o
 * aporte sugerido veria a calculadora dizer que ainda falta dinheiro.
 */
export const moneyUp = (value) => (Number.isFinite(value) ? currency.format(Math.ceil(value)) : '—');

/** Valor monetário abreviado, para eixos: "R$ 1,5 mi". */
export const moneyShort = (value) => (Number.isFinite(value) ? currencyCompact.format(value) : '—');

/** Valor com sinal explícito, para deltas. */
export const moneySigned = (value) =>
  !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : '−'}${currency.format(Math.abs(value))}`;

export const pct = (value) => (Number.isFinite(value) ? percent.format(value) : '—');
export const pctShort = (value) => (Number.isFinite(value) ? percentShort.format(value) : '—');

/** Quantidade de anos com a concordância correta. */
export const anos = (count) => `${count} ${count === 1 ? 'ano' : 'anos'}`;
