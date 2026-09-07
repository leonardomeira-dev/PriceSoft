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
 * @param {number} [params.extraContribution] segundo fluxo aportado no primeiro mês,
 *   usado para a renda passiva reinvestida — cresce por conta própria e, por não
 *   depender do aporte, preserva a linearidade explorada por
 *   {@link solveMonthlyContribution}
 * @param {number} [params.extraGrowth] variação real mensal do segundo fluxo
 * @returns {{balance: number, totalContributed: number, totalExtra: number,
 *            series: number[], contributions: number[], extras: number[]}}
 *   `series[m]` é o saldo ao fim do mês `m`, com `series[0]` igual ao saldo inicial;
 *   `contributions[m]` e `extras[m]` são os dois fluxos do mês `m` (índice 0 é sempre 0).
 */
export function accumulate({
  initialBalance,
  monthlyContribution,
  monthlyRate,
  months,
  contributionGrowth = 0,
  extraContribution = 0,
  extraGrowth = 0,
}) {
  const series = [initialBalance];
  const contributions = [0];
  const extras = [0];
  let balance = initialBalance;
  let contribution = monthlyContribution;
  let extra = extraContribution;
  let totalContributed = 0;
  let totalExtra = 0;

  for (let month = 1; month <= months; month++) {
    balance = balance * (1 + monthlyRate) + contribution + extra;
    totalContributed += contribution;
    totalExtra += extra;
    contributions.push(contribution);
    extras.push(extra);
    contribution *= 1 + contributionGrowth;
    extra *= 1 + extraGrowth;
    series.push(balance);
  }

  return { balance, totalContributed, totalExtra, series, contributions, extras };
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
 * @param {number} [params.extraContribution] fluxo paralelo (renda passiva reinvestida)
 * @param {number} [params.extraGrowth] variação real mensal do fluxo paralelo
 * @returns {number} aporte mensal necessário (0 se o alvo já é atingido)
 */
export function solveMonthlyContribution({
  initialBalance,
  monthlyRate,
  months,
  targetBalance,
  contributionGrowth = 0,
  extraContribution = 0,
  extraGrowth = 0,
}) {
  const withoutContributions = accumulate({
    initialBalance,
    monthlyContribution: 0,
    monthlyRate,
    months,
    contributionGrowth,
    extraContribution,
    extraGrowth,
  }).balance;

  if (withoutContributions >= targetBalance) return 0;

  // O fluxo extra entra no termo constante, não no marginal: o ganho por unidade
  // de aporte é medido sem ele.
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
  if (!Number.isFinite(input.productiveAssets ?? 0) || (input.productiveAssets ?? 0) < 0) {
    errors.push('O patrimônio produtivo não pode ser negativo.');
  }
  if (!Number.isFinite(input.passiveIncome ?? 0) || (input.passiveIncome ?? 0) < 0) {
    errors.push('A renda passiva atual não pode ser negativa.');
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
 * @param {number} [input.otherMonthlyIncome] renda mensal de outras fontes que só
 *   começam na aposentadoria (INSS, previdência privada)
 * @param {number} [input.legacy] herança desejada ao fim do período
 * @param {number} [input.productiveAssets] valor de mercado hoje do patrimônio
 *   produtivo (imóveis alugados, participação em negócio) — diferente da carteira
 *   financeira porque não é consumido: continua rendendo
 * @param {number} [input.passiveIncome] renda mensal que esse patrimônio já gera hoje
 * @param {number} [input.productiveRealGrowth] valorização anual do patrimônio
 *   produtivo **acima da inflação** (já real, não passa por Fisher)
 * @param {boolean} [input.reinvestPassiveIncome] se a renda passiva é reinvestida na
 *   carteira durante a acumulação, em vez de consumida
 * @param {boolean} [input.sellProductiveAtRetirement] se o patrimônio produtivo é
 *   vendido ao se aposentar, virando carteira e encerrando a renda passiva
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
    productiveAssets = 0,
    passiveIncome = 0,
    productiveRealGrowth = 0,
    reinvestPassiveIncome = true,
    sellProductiveAtRetirement = false,
  } = input;

  const accumulationMonths = Math.round((retirementAge - currentAge) * 12);
  const retirementMonths = Math.round((endAge - retirementAge) * 12);

  const accumulationRate = annualToMonthly(realAnnualRate(accumulationReturn, inflation));
  const retirementRate = annualToMonthly(realAnnualRate(retirementReturn, inflation));

  // A valorização do patrimônio produtivo já é informada em termos reais, então
  // não passa por Fisher — só pela equivalência de período.
  const productiveRate = annualToMonthly(productiveRealGrowth);

  // Aporte congelado em valor nominal perde poder de compra a cada mês.
  const monthlyInflation = annualToMonthly(inflation);
  const contributionGrowth = indexContribution ? 0 : 1 / (1 + monthlyInflation) - 1;

  // A renda passiva acompanha o valor do bem que a gera: o rendimento percentual
  // fica constante, então ela cresce à mesma taxa real do patrimônio produtivo.
  const reinvested = reinvestPassiveIncome ? passiveIncome : 0;

  const accumulation = accumulate({
    initialBalance,
    monthlyContribution,
    monthlyRate: accumulationRate,
    months: accumulationMonths,
    contributionGrowth,
    extraContribution: reinvested,
    extraGrowth: productiveRate,
  });

  const portfolioAtRetirement = accumulation.balance;
  const productiveAtRetirement = productiveAssets * Math.pow(1 + productiveRate, accumulationMonths);
  const passiveAtRetirement = passiveIncome * Math.pow(1 + productiveRate, accumulationMonths);

  // Vender o bem transforma seu valor em carteira e encerra a renda passiva;
  // mantê-lo preserva a renda e deixa o bem fora do que é consumido.
  const balanceAtRetirement =
    portfolioAtRetirement + (sellProductiveAtRetirement ? productiveAtRetirement : 0);
  const passiveDuringRetirement = sellProductiveAtRetirement ? 0 : passiveAtRetirement;

  // Rendas que chegam sem depender da carteira. A renda passiva é tratada como
  // constante em termos reais durante a aposentadoria — premissa conservadora.
  const supplementalIncome = otherMonthlyIncome + passiveDuringRetirement;

  const sustainableIncome = sustainableWithdrawal({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    legacy,
  });

  const neededFromPortfolio = Math.max(0, desiredMonthlyIncome - supplementalIncome);

  const targetBalance = requiredBalance({
    monthlyIncome: neededFromPortfolio,
    monthlyRate: retirementRate,
    months: retirementMonths,
    legacy,
  });

  // O alvo é de carteira; se o bem for vendido, parte dele já vem da venda.
  const targetFromContributions =
    targetBalance - (sellProductiveAtRetirement ? productiveAtRetirement : 0);

  const requiredMonthlyContribution = solveMonthlyContribution({
    initialBalance,
    monthlyRate: accumulationRate,
    months: accumulationMonths,
    targetBalance: targetFromContributions,
    contributionGrowth,
    extraContribution: reinvested,
    extraGrowth: productiveRate,
  });

  const retirementProjection = decumulate({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    monthlyWithdrawal: sustainableIncome,
  });

  const desiredProjection = decumulate({
    balance: balanceAtRetirement,
    monthlyRate: retirementRate,
    months: retirementMonths,
    monthlyWithdrawal: neededFromPortfolio,
  });

  // Valor do bem mês a mês: cresce sempre; zera na venda ao se aposentar.
  const productiveSeries = [];
  for (let month = 0; month <= accumulationMonths + retirementMonths; month++) {
    const value = productiveAssets * Math.pow(1 + productiveRate, month);
    const sold = sellProductiveAtRetirement && month > accumulationMonths;
    productiveSeries.push(sold ? 0 : value);
  }

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

    portfolioAtRetirement,
    balanceAtRetirement,
    totalContributed: accumulation.totalContributed,
    totalPassiveReinvested: accumulation.totalExtra,
    investmentGrowth:
      portfolioAtRetirement - initialBalance - accumulation.totalContributed - accumulation.totalExtra,

    productiveAtRetirement,
    passiveAtRetirement,
    passiveDuringRetirement,
    supplementalIncome,
    productiveAtEnd: productiveSeries[productiveSeries.length - 1],

    sustainableIncome,
    projectedMonthlyIncome: sustainableIncome + supplementalIncome,
    desiredMonthlyIncome,
    neededFromPortfolio,

    targetBalance,
    gap,
    onTrack: gap <= gapTolerance,
    requiredMonthlyContribution,
    additionalMonthlyContribution: Math.max(0, requiredMonthlyContribution - monthlyContribution),

    depletionAge: depletionAge(retirementAge, desiredProjection.depletionMonth),
    legacyAtEnd: retirementProjection.finalBalance,
    estateAtEnd: retirementProjection.finalBalance + productiveSeries[productiveSeries.length - 1],

    balanceSeries: [...accumulation.series, ...retirementProjection.series.slice(1)],
    productiveSeries,
    // Fluxo de caixa alinhado a `balanceSeries`: positivo é aporte, negativo é
    // retirada. Permite separar aporte de rendimento sem refazer a simulação.
    flowSeries: [
      ...accumulation.contributions.map((value, month) => value + accumulation.extras[month]),
      ...retirementProjection.withdrawals.slice(1).map((value) => -value),
    ],
  };
}
