/**
 * Motor de cálculo da calculadora de aposentadoria.
 *
 * Convenções adotadas em todo o módulo:
 *
 * - Todos os valores monetários são expressos em **moeda de hoje** (termos reais).
 *   Para isso os retornos nominais informados pelo usuário são convertidos em
 *   retornos reais pela equação de Fisher, e a inflação nunca aparece nos saldos.
 * - As taxas anuais são convertidas para mensais por capitalização composta
 *   (equivalência), não por divisão simples por 12.
 * - Aportes e retiradas ocorrem no **fim** de cada mês (anuidade postecipada),
 *   de modo que o saldo de um mês é `saldo * (1 + i) + aporte - retirada`.
 *
 * O módulo é puro: não conhece DOM, formatação ou unidades de exibição.
 */

/** Tolerância usada para tratar uma taxa como zero e evitar divisão por zero. */
const EPS = 1e-12;

/**
 * Converte uma taxa anual efetiva na taxa mensal equivalente.
 * @param {number} annualRate taxa anual em decimal (0.08 = 8% a.a.)
 * @returns {number} taxa mensal em decimal
 */
export function annualToMonthly(annualRate) {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

/**
 * Taxa real anual a partir da taxa nominal e da inflação (equação de Fisher).
 * @param {number} nominalAnnual taxa nominal anual em decimal
 * @param {number} inflationAnnual inflação anual em decimal
 * @returns {number} taxa real anual em decimal
 */
export function realAnnualRate(nominalAnnual, inflationAnnual) {
  return (1 + nominalAnnual) / (1 + inflationAnnual) - 1;
}

/**
 * Fator de valor presente de uma anuidade postecipada de R$ 1,00 por período.
 * @param {number} rate taxa por período
 * @param {number} periods número de períodos
 * @returns {number} fator de valor presente
 */
export function annuityPresentValueFactor(rate, periods) {
  if (periods <= 0) return 0;
  if (Math.abs(rate) < EPS) return periods;
  return (1 - Math.pow(1 + rate, -periods)) / rate;
}

/**
 * Simula a fase de acumulação mês a mês.
 *
 * `contributionGrowth` permite que o aporte varie em termos reais: vale 0 quando
 * o aporte é corrigido pela inflação (poder de compra constante) e é negativo
 * quando o aporte fica congelado em valor nominal e portanto perde valor real.
 *
 * @param {object} params
 * @param {number} params.initialBalance saldo inicial
 * @param {number} params.monthlyContribution aporte do primeiro mês
 * @param {number} params.monthlyRate taxa real mensal
 * @param {number} params.months número de meses
 * @param {number} [params.contributionGrowth] variação real mensal do aporte
 * @returns {{balance: number, totalContributed: number, series: number[],
 *            contributions: number[]}}
 *   `series[m]` é o saldo ao fim do mês `m`, com `series[0]` igual ao saldo inicial;
 *   `contributions[m]` é o aporte feito no mês `m` (`contributions[0]` é sempre 0).
 */
export function accumulate({
  initialBalance,
  monthlyContribution,
  monthlyRate,
  months,
  contributionGrowth = 0,
}) {
  const series = [initialBalance];
  const contributions = [0];
  let balance = initialBalance;
  let contribution = monthlyContribution;
  let totalContributed = 0;

  for (let month = 1; month <= months; month++) {
    balance = balance * (1 + monthlyRate) + contribution;
    totalContributed += contribution;
    contributions.push(contribution);
    contribution *= 1 + contributionGrowth;
    series.push(balance);
  }

  return { balance, totalContributed, series, contributions };
}

/**
 * Simula a fase de usufruto mês a mês, retirando um valor fixo real.
 *
 * @param {object} params
 * @param {number} params.balance saldo no início da aposentadoria
 * @param {number} params.monthlyRate taxa real mensal
 * @param {number} params.months número de meses de aposentadoria
 * @param {number} params.monthlyWithdrawal retirada mensal
 * @returns {{series: number[], finalBalance: number, depletionMonth: number|null,
 *            totalWithdrawn: number, withdrawals: number[]}}
 *   `depletionMonth` é o mês em que o saldo zera, ou `null` se o dinheiro dura;
 *   `withdrawals[m]` é a retirada do mês `m` (`withdrawals[0]` é sempre 0), já
 *   limitada ao que havia em caixa.
 */
export function decumulate({ balance, monthlyRate, months, monthlyWithdrawal }) {
  const series = [balance];
  const withdrawals = [0];
  let current = balance;
  let depletionMonth = null;
  let totalWithdrawn = 0;

  for (let month = 1; month <= months; month++) {
    const available = current * (1 + monthlyRate);
    const withdrawal = Math.min(available > 0 ? available : 0, monthlyWithdrawal);
    current = available - withdrawal;
    totalWithdrawn += withdrawal;
    withdrawals.push(withdrawal);

    if (current <= 0) {
      current = 0;
      if (depletionMonth === null) depletionMonth = month;
    }
    series.push(current);
  }

  return { series, finalBalance: current, depletionMonth, totalWithdrawn, withdrawals };
}

/**
 * Maior retirada mensal constante que o saldo sustenta pelo período informado,
 * deixando `legacy` como herança ao final.
 *
 * @param {object} params
 * @param {number} params.balance saldo no início da aposentadoria
 * @param {number} params.monthlyRate taxa real mensal
 * @param {number} params.months número de meses de aposentadoria
 * @param {number} [params.legacy] saldo desejado ao fim do período
 * @returns {number} retirada mensal sustentável (nunca negativa)
 */
export function sustainableWithdrawal({ balance, monthlyRate, months, legacy = 0 }) {
  if (months <= 0) return 0;
  const factor = annuityPresentValueFactor(monthlyRate, months);
  if (factor <= 0) return 0;
  const presentValueOfLegacy = legacy / Math.pow(1 + monthlyRate, months);
  return Math.max(0, (balance - presentValueOfLegacy) / factor);
}

/**
 * Saldo necessário no início da aposentadoria para bancar uma renda mensal
 * durante todo o período e ainda deixar `legacy` de herança.
 *
 * @param {object} params
 * @param {number} params.monthlyIncome renda mensal desejada da carteira
 * @param {number} params.monthlyRate taxa real mensal
 * @param {number} params.months número de meses de aposentadoria
 * @param {number} [params.legacy] herança desejada
 * @returns {number} saldo necessário
 */
export function requiredBalance({ monthlyIncome, monthlyRate, months, legacy = 0 }) {
  const factor = annuityPresentValueFactor(monthlyRate, months);
  return monthlyIncome * factor + legacy / Math.pow(1 + monthlyRate, months);
}

/**
 * Aporte mensal necessário para chegar a `targetBalance` no fim da acumulação.
 *
 * O saldo acumulado é uma função afim do aporte, então basta medir o saldo sem
 * aporte e o ganho marginal de um aporte unitário — não é preciso iterar.
 *
 * @param {object} params
 * @param {number} params.initialBalance saldo inicial
 * @param {number} params.monthlyRate taxa real mensal
 * @param {number} params.months número de meses de acumulação
 * @param {number} params.targetBalance saldo alvo
 * @param {number} [params.contributionGrowth] variação real mensal do aporte
 * @returns {number} aporte mensal necessário (0 se o alvo já é atingido)
 */
export function solveMonthlyContribution({
  initialBalance,
  monthlyRate,
  months,
  targetBalance,
  contributionGrowth = 0,
}) {
  const withoutContributions = accumulate({
    initialBalance,
    monthlyContribution: 0,
    monthlyRate,
    months,
    contributionGrowth,
  }).balance;

  if (withoutContributions >= targetBalance) return 0;

  const perUnitOfContribution = accumulate({
    initialBalance: 0,
    monthlyContribution: 1,
    monthlyRate,
    months,
    contributionGrowth,
  }).balance;

  if (perUnitOfContribution <= EPS) return Infinity;
  return (targetBalance - withoutContributions) / perUnitOfContribution;
}

/**
 * Idade em que o patrimônio se esgota, dado o mês de esgotamento da simulação.
 * @param {number} retirementAge idade de aposentadoria
 * @param {number|null} depletionMonth mês de esgotamento
 * @returns {number|null} idade de esgotamento, ou `null` se o dinheiro dura
 */
export function depletionAge(retirementAge, depletionMonth) {
  return depletionMonth === null ? null : retirementAge + depletionMonth / 12;
}

/**
 * Valida os dados de entrada do plano.
 * @param {object} input mesmas chaves aceitas por {@link project}
 * @returns {string[]} lista de mensagens de erro (vazia quando tudo é válido)
 */
export function validate(input) {
  const errors = [];
  const {
    currentAge,
    retirementAge,
    endAge,
    initialBalance,
    monthlyContribution,
    inflation,
  } = input;

  if (!Number.isFinite(currentAge) || currentAge < 0 || currentAge > 110) {
    errors.push('Informe uma idade atual entre 0 e 110 anos.');
  }
  if (!(retirementAge > currentAge)) {
    errors.push('A idade de aposentadoria deve ser maior que a idade atual.');
  }
  if (!(endAge > retirementAge)) {
    errors.push('A expectativa de vida deve ser maior que a idade de aposentadoria.');
  }
  if (!Number.isFinite(initialBalance) || initialBalance < 0) {
    errors.push('O patrimônio atual não pode ser negativo.');
  }
  if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0) {
    errors.push('O aporte mensal não pode ser negativo.');
  }
  if (!Number.isFinite(inflation) || inflation <= -1) {
    errors.push('Informe uma inflação válida.');
  }

  return errors;
}

/**
 * Projeta o plano completo de aposentadoria.
 *
 * Todas as taxas entram em decimal ao ano (0.08 = 8% a.a.) e todos os valores
 * monetários de saída estão em moeda de hoje.
 *
 * @param {object} input
 * @param {number} input.currentAge idade atual
 * @param {number} input.retirementAge idade em que pretende se aposentar
 * @param {number} input.endAge idade até a qual a renda deve durar
 * @param {number} input.initialBalance patrimônio já acumulado
 * @param {number} input.monthlyContribution aporte mensal atual
 * @param {number} input.accumulationReturn retorno nominal anual na acumulação
 * @param {number} input.retirementReturn retorno nominal anual na aposentadoria
 * @param {number} input.inflation inflação anual esperada
 * @param {boolean} [input.indexContribution] se o aporte é corrigido pela inflação
 * @param {number} [input.desiredMonthlyIncome] renda mensal desejada (total)
 * @param {number} [input.otherMonthlyIncome] renda mensal de outras fontes (INSS etc.)
 * @param {number} [input.legacy] herança desejada ao fim do período
 * @returns {object} resultado consolidado da projeção
 */
export function project(input) {
  const {
    currentAge,
    retirementAge,
    endAge,
    initialBalance,
    monthlyContribution,
    accumulationReturn,
    retirementReturn,
    inflation,
    indexContribution = true,
    desiredMonthlyIncome = 0,
    otherMonthlyIncome = 0,
    legacy = 0,
  } = input;

  const accumulationMonths = Math.round((retirementAge - currentAge) * 12);
  const retirementMonths = Math.round((endAge - retirementAge) * 12);

  const accumulationRate = annualToMonthly(realAnnualRate(accumulationReturn, inflation));
  const retirementRate = annualToMonthly(realAnnualRate(retirementReturn, inflation));

  // Aporte congelado em valor nominal perde poder de compra a cada mês.
  const monthlyInflation = annualToMonthly(inflation);
  const contributionGrowth = indexContribution ? 0 : 1 / (1 + monthlyInflation) - 1;

  const accumulation = accumulate({
    initialBalance,
    monthlyContribution,
    monthlyRate: accumulationRate,
    months: accumulationMonths,
    contributionGrowth,
  });

  const balanceAtRetirement = accumulation.balance;

  const sustainableIncome = sustainableWithdrawal({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    legacy,
  });

  const neededFromPortfolio = Math.max(0, desiredMonthlyIncome - otherMonthlyIncome);

  const targetBalance = requiredBalance({
    monthlyIncome: neededFromPortfolio,
    monthlyRate: retirementRate,
    months: retirementMonths,
    legacy,
  });

  const requiredMonthlyContribution = solveMonthlyContribution({
    initialBalance,
    monthlyRate: accumulationRate,
    months: accumulationMonths,
    targetBalance,
    contributionGrowth,
  });

  // Curva efetivamente exibida: o que o plano atual sustenta.
  const retirementProjection = decumulate({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    monthlyWithdrawal: sustainableIncome,
  });

  // Cenário alternativo: e se o usuário insistir em retirar a renda desejada?
  const desiredProjection = decumulate({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    monthlyWithdrawal: neededFromPortfolio,
  });

  const gap = targetBalance - balanceAtRetirement;

  // O saldo alvo e o saldo projetado vêm de caminhos de cálculo diferentes, então
  // um plano exatamente no alvo fecha com uma sobra de arredondamento. Tolerar um
  // centavo (ou o erro relativo do alvo, o que for maior) evita marcar esse plano
  // como insuficiente.
  const gapTolerance = Math.max(0.01, Math.abs(targetBalance) * 1e-9);

  return {
    accumulationMonths,
    retirementMonths,
    accumulationRate,
    retirementRate,
    realAccumulationReturn: realAnnualRate(accumulationReturn, inflation),
    realRetirementReturn: realAnnualRate(retirementReturn, inflation),

    balanceAtRetirement,
    totalContributed: accumulation.totalContributed,
    investmentGrowth: balanceAtRetirement - initialBalance - accumulation.totalContributed,

    sustainableIncome,
    projectedMonthlyIncome: sustainableIncome + otherMonthlyIncome,
    desiredMonthlyIncome,
    neededFromPortfolio,

    targetBalance,
    gap,
    onTrack: gap <= gapTolerance,
    requiredMonthlyContribution,
    additionalMonthlyContribution: Math.max(0, requiredMonthlyContribution - monthlyContribution),

    depletionAge: depletionAge(retirementAge, desiredProjection.depletionMonth),
    legacyAtEnd: retirementProjection.finalBalance,

    balanceSeries: [...accumulation.series, ...retirementProjection.series.slice(1)],
    // Fluxo de caixa alinhado a `balanceSeries`: positivo é aporte, negativo é
    // retirada. Permite separar aporte de rendimento sem refazer a simulação.
    flowSeries: [
      ...accumulation.contributions,
      ...retirementProjection.withdrawals.slice(1).map((value) => -value),
    ],
  };
}
