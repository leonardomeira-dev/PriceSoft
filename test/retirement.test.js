import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accumulate,
  annualToMonthly,
  annuityPresentValueFactor,
  decumulate,
  project,
  realAnnualRate,
  requiredBalance,
  solveMonthlyContribution,
  sustainableWithdrawal,
  validate,
} from '../src/retirement.js';

/** Compara dois números com tolerância absoluta. */
const closeTo = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected}, recebido ${actual} (tolerância ${tolerance})`,
  );

test('annualToMonthly compõe de volta para a taxa anual', () => {
  const monthly = annualToMonthly(0.1);
  closeTo(Math.pow(1 + monthly, 12) - 1, 0.1, 1e-12);
  // Equivalência composta é menor que a divisão ingênua por 12.
  assert.ok(monthly < 0.1 / 12);
});

test('annualToMonthly trata taxa zero', () => {
  closeTo(annualToMonthly(0), 0, 1e-15);
});

test('realAnnualRate aplica a equação de Fisher', () => {
  closeTo(realAnnualRate(0.1, 0.04), 1.1 / 1.04 - 1, 1e-15);
  // Retorno igual à inflação significa ganho real nulo.
  closeTo(realAnnualRate(0.05, 0.05), 0, 1e-15);
  // Retorno abaixo da inflação destrói poder de compra.
  assert.ok(realAnnualRate(0.02, 0.06) < 0);
});

test('annuityPresentValueFactor degenera para n quando a taxa é zero', () => {
  closeTo(annuityPresentValueFactor(0, 240), 240, 1e-9);
  assert.equal(annuityPresentValueFactor(0.01, 0), 0);
});

test('annuityPresentValueFactor bate com a fórmula fechada', () => {
  const rate = 0.005;
  const periods = 360;
  closeTo(
    annuityPresentValueFactor(rate, periods),
    (1 - Math.pow(1 + rate, -periods)) / rate,
    1e-12,
  );
});

test('accumulate sem juros é apenas a soma dos aportes', () => {
  const { balance, totalContributed, series } = accumulate({
    initialBalance: 1000,
    monthlyContribution: 100,
    monthlyRate: 0,
    months: 12,
  });
  closeTo(balance, 1000 + 1200);
  closeTo(totalContributed, 1200);
  assert.equal(series.length, 13);
  assert.equal(series[0], 1000);
});

test('accumulate bate com a fórmula fechada de valor futuro', () => {
  const rate = 0.006;
  const months = 300;
  const initialBalance = 50_000;
  const monthlyContribution = 1_500;

  const { balance } = accumulate({ initialBalance, monthlyContribution, monthlyRate: rate, months });

  const expected =
    initialBalance * Math.pow(1 + rate, months) +
    monthlyContribution * ((Math.pow(1 + rate, months) - 1) / rate);

  closeTo(balance, expected, 1e-6);
});

test('accumulate com aporte não corrigido acumula menos em termos reais', () => {
  const common = { initialBalance: 0, monthlyContribution: 1000, monthlyRate: 0.004, months: 240 };
  const indexed = accumulate({ ...common }).balance;
  const frozen = accumulate({ ...common, contributionGrowth: -0.003 }).balance;
  assert.ok(frozen < indexed);
});

test('sustainableWithdrawal e requiredBalance são inversos', () => {
  const monthlyRate = 0.0035;
  const months = 360;
  const legacy = 100_000;
  const balance = 2_000_000;

  const income = sustainableWithdrawal({ balance, monthlyRate, months, legacy });
  closeTo(requiredBalance({ monthlyIncome: income, monthlyRate, months, legacy }), balance, 1e-6);
});

test('sustainableWithdrawal nunca é negativa quando a herança é inviável', () => {
  const income = sustainableWithdrawal({
    balance: 10_000,
    monthlyRate: 0.003,
    months: 240,
    legacy: 5_000_000,
  });
  assert.equal(income, 0);
});

test('retirar o valor sustentável deixa exatamente a herança pedida', () => {
  const monthlyRate = 0.003;
  const months = 300;
  const legacy = 250_000;
  const balance = 1_800_000;

  const income = sustainableWithdrawal({ balance, monthlyRate, months, legacy });
  const { finalBalance, depletionMonth } = decumulate({
    balance,
    monthlyRate,
    months,
    monthlyWithdrawal: income,
  });

  closeTo(finalBalance, legacy, 1e-4);
  assert.equal(depletionMonth, null);
});

test('decumulate detecta o mês de esgotamento e nunca fica negativo', () => {
  const { series, finalBalance, depletionMonth } = decumulate({
    balance: 10_000,
    monthlyRate: 0,
    months: 24,
    monthlyWithdrawal: 1_000,
  });

  assert.equal(depletionMonth, 10);
  assert.equal(finalBalance, 0);
  assert.ok(series.every((value) => value >= 0));
});

test('decumulate não retira mais do que existe no último mês', () => {
  const { totalWithdrawn } = decumulate({
    balance: 2_500,
    monthlyRate: 0,
    months: 12,
    monthlyWithdrawal: 1_000,
  });
  closeTo(totalWithdrawn, 2_500);
});

test('solveMonthlyContribution atinge o saldo alvo', () => {
  const params = { initialBalance: 20_000, monthlyRate: 0.005, months: 240 };
  const targetBalance = 1_500_000;

  const contribution = solveMonthlyContribution({ ...params, targetBalance });
  const { balance } = accumulate({ ...params, monthlyContribution: contribution });

  closeTo(balance, targetBalance, 1e-6);
});

test('solveMonthlyContribution retorna zero quando o saldo inicial já basta', () => {
  const contribution = solveMonthlyContribution({
    initialBalance: 1_000_000,
    monthlyRate: 0.005,
    months: 120,
    targetBalance: 500_000,
  });
  assert.equal(contribution, 0);
});

/** Plano de referência usado nos testes de integração. */
const basePlan = {
  currentAge: 30,
  retirementAge: 65,
  endAge: 90,
  initialBalance: 50_000,
  monthlyContribution: 1_500,
  accumulationReturn: 0.09,
  retirementReturn: 0.06,
  inflation: 0.04,
  indexContribution: true,
  desiredMonthlyIncome: 8_000,
  otherMonthlyIncome: 2_000,
  legacy: 0,
};

test('project devolve uma projeção coerente', () => {
  const result = project(basePlan);

  assert.equal(result.accumulationMonths, 420);
  assert.equal(result.retirementMonths, 300);

  // Só a carteira precisa cobrir a renda desejada líquida das outras rendas.
  closeTo(result.neededFromPortfolio, 6_000);

  // Rendimento real positivo faz o saldo superar o total investido.
  assert.ok(result.balanceAtRetirement > basePlan.initialBalance + result.totalContributed);
  closeTo(
    result.investmentGrowth,
    result.balanceAtRetirement - basePlan.initialBalance - result.totalContributed,
    1e-6,
  );

  // A série cobre acumulação e usufruto sem duplicar o mês da virada.
  assert.equal(result.balanceSeries.length, 420 + 300 + 1);
  closeTo(result.balanceSeries[420], result.balanceAtRetirement, 1e-6);

  closeTo(result.projectedMonthlyIncome, result.sustainableIncome + basePlan.otherMonthlyIncome);
  closeTo(result.gap, result.targetBalance - result.balanceAtRetirement, 1e-6);
});

test('project marca o plano como suficiente quando a renda sustentável cobre a meta', () => {
  const result = project({ ...basePlan, monthlyContribution: 100_000 });
  assert.equal(result.onTrack, true);
  assert.ok(result.sustainableIncome > result.neededFromPortfolio);
  assert.equal(result.additionalMonthlyContribution, 0);
  // Com folga, o dinheiro nunca acaba antes do fim do período.
  assert.equal(result.depletionAge, null);
});

test('project aponta o aporte adicional necessário quando falta patrimônio', () => {
  const result = project({ ...basePlan, monthlyContribution: 100 });

  assert.equal(result.onTrack, false);
  assert.ok(result.gap > 0);
  assert.ok(result.requiredMonthlyContribution > 100);
  closeTo(result.additionalMonthlyContribution, result.requiredMonthlyContribution - 100);

  // O aporte sugerido de fato fecha a lacuna.
  const fixed = project({ ...basePlan, monthlyContribution: result.requiredMonthlyContribution });
  assert.equal(fixed.onTrack, true);
  closeTo(fixed.sustainableIncome, fixed.neededFromPortfolio, 1e-6);
});

test('project informa a idade em que o dinheiro acaba num plano insuficiente', () => {
  const result = project({ ...basePlan, monthlyContribution: 100 });
  assert.ok(result.depletionAge !== null);
  assert.ok(result.depletionAge > basePlan.retirementAge);
  assert.ok(result.depletionAge < basePlan.endAge);
});

test('project honra a herança desejada aumentando o patrimônio necessário', () => {
  const semHeranca = project({ ...basePlan, legacy: 0 });
  const comHeranca = project({ ...basePlan, legacy: 500_000 });

  assert.ok(comHeranca.targetBalance > semHeranca.targetBalance);
  assert.ok(comHeranca.sustainableIncome < semHeranca.sustainableIncome);
});

test('project trata retorno real nulo sem divisão por zero', () => {
  const result = project({
    ...basePlan,
    accumulationReturn: 0.04,
    retirementReturn: 0.04,
    inflation: 0.04,
  });

  closeTo(result.realAccumulationReturn, 0, 1e-15);
  closeTo(result.balanceAtRetirement, basePlan.initialBalance + result.totalContributed, 1e-6);
  // Sem juros reais, a renda é o saldo dividido pelos meses de aposentadoria.
  closeTo(result.sustainableIncome, result.balanceAtRetirement / 300, 1e-6);
});

test('project reconhece que outras rendas podem cobrir tudo', () => {
  const result = project({ ...basePlan, otherMonthlyIncome: 10_000 });
  assert.equal(result.neededFromPortfolio, 0);
  assert.equal(result.targetBalance, 0);
  assert.equal(result.onTrack, true);
});

test('validate aceita um plano coerente', () => {
  assert.deepEqual(validate(basePlan), []);
});

test('validate rejeita idades e valores inconsistentes', () => {
  assert.ok(validate({ ...basePlan, retirementAge: 25 }).length > 0);
  assert.ok(validate({ ...basePlan, endAge: 60 }).length > 0);
  assert.ok(validate({ ...basePlan, initialBalance: -1 }).length > 0);
  assert.ok(validate({ ...basePlan, monthlyContribution: -1 }).length > 0);
  assert.ok(validate({ ...basePlan, currentAge: Number.NaN }).length > 0);
});

test('accumulate registra o aporte de cada mês', () => {
  const { contributions } = accumulate({
    initialBalance: 0,
    monthlyContribution: 500,
    monthlyRate: 0.01,
    months: 3,
    contributionGrowth: -0.5,
  });
  assert.deepEqual(contributions, [0, 500, 250, 125]);
});

test('decumulate registra a retirada de cada mês, limitada ao caixa', () => {
  const { withdrawals } = decumulate({
    balance: 2_500,
    monthlyRate: 0,
    months: 4,
    monthlyWithdrawal: 1_000,
  });
  assert.deepEqual(withdrawals, [0, 1_000, 1_000, 500, 0]);
});

test('flowSeries acompanha balanceSeries e reconcilia saldo com rendimento', () => {
  const result = project(basePlan);
  assert.equal(result.flowSeries.length, result.balanceSeries.length);
  assert.equal(result.flowSeries[0], 0);

  // Aportes são positivos na acumulação e retiradas negativas no usufruto.
  assert.ok(result.flowSeries[1] > 0);
  assert.ok(result.flowSeries[result.accumulationMonths + 1] < 0);

  // Saldo final = saldo inicial + fluxos + rendimentos implícitos de cada mês.
  const totalFlow = result.flowSeries.reduce((sum, value) => sum + value, 0);
  const totalReturn = result.balanceSeries.reduce(
    (sum, balance, month) =>
      month === 0 ? sum : sum + result.balanceSeries[month] - result.balanceSeries[month - 1] - result.flowSeries[month],
    0,
  );
  closeTo(
    basePlan.initialBalance + totalFlow + totalReturn,
    result.balanceSeries.at(-1),
    1e-6,
  );
});

/* ---------- Patrimônio produtivo e renda passiva ---------- */

/** Plano com um imóvel alugado: R$ 400 mil que rendem R$ 2.000 por mês hoje. */
const comImovel = {
  ...basePlan,
  productiveAssets: 400_000,
  passiveIncome: 2_000,
  productiveRealGrowth: 0,
  reinvestPassiveIncome: true,
  sellProductiveAtRetirement: false,
};

test('sem patrimônio produtivo o resultado é idêntico ao plano antigo', () => {
  const semCampos = project(basePlan);
  const comZeros = project({ ...basePlan, productiveAssets: 0, passiveIncome: 0 });

  closeTo(comZeros.balanceAtRetirement, semCampos.balanceAtRetirement, 1e-9);
  closeTo(comZeros.targetBalance, semCampos.targetBalance, 1e-9);
  assert.equal(comZeros.productiveAtRetirement, 0);
  assert.equal(comZeros.passiveDuringRetirement, 0);
});

test('renda passiva reinvestida engorda a carteira', () => {
  const reinveste = project(comImovel);
  const consome = project({ ...comImovel, reinvestPassiveIncome: false });

  assert.ok(reinveste.portfolioAtRetirement > consome.portfolioAtRetirement);
  closeTo(reinveste.totalPassiveReinvested, 2_000 * 420);
  assert.equal(consome.totalPassiveReinvested, 0);

  // O ganho vem do fluxo extra e dos juros sobre ele, nunca do aporte declarado.
  closeTo(reinveste.totalContributed, consome.totalContributed, 1e-9);
});

test('renda passiva continua na aposentadoria e alivia a carteira', () => {
  const semImovel = project(basePlan);
  const comAluguel = project({ ...comImovel, reinvestPassiveIncome: false });

  // A carteira precisa cobrir R$ 2.000 a menos por mês.
  closeTo(comAluguel.neededFromPortfolio, semImovel.neededFromPortfolio - 2_000);
  assert.ok(comAluguel.targetBalance < semImovel.targetBalance);
  closeTo(comAluguel.supplementalIncome, basePlan.otherMonthlyIncome + 2_000);
});

test('a renda projetada soma carteira, INSS e renda passiva', () => {
  const result = project(comImovel);
  closeTo(
    result.projectedMonthlyIncome,
    result.sustainableIncome + basePlan.otherMonthlyIncome + result.passiveDuringRetirement,
  );
});

test('vender o patrimônio produtivo troca renda passiva por saldo', () => {
  const mantem = project(comImovel);
  const vende = project({ ...comImovel, sellProductiveAtRetirement: true });

  // O valor do bem entra na carteira consumível...
  closeTo(vende.balanceAtRetirement, vende.portfolioAtRetirement + vende.productiveAtRetirement, 1e-6);
  assert.ok(vende.balanceAtRetirement > mantem.balanceAtRetirement);

  // ...e a renda passiva acaba.
  assert.equal(vende.passiveDuringRetirement, 0);
  assert.ok(vende.neededFromPortfolio > mantem.neededFromPortfolio);

  // Nada do bem sobra para os herdeiros depois da venda.
  assert.equal(vende.productiveAtEnd, 0);
});

test('a valorização real faz bem e renda crescerem juntos', () => {
  const parado = project(comImovel);
  const valoriza = project({ ...comImovel, productiveRealGrowth: 0.02 });

  assert.ok(valoriza.productiveAtRetirement > parado.productiveAtRetirement);
  assert.ok(valoriza.passiveAtRetirement > parado.passiveAtRetirement);

  // O rendimento percentual do bem não muda: os dois crescem na mesma proporção.
  closeTo(
    valoriza.passiveAtRetirement / valoriza.productiveAtRetirement,
    parado.passiveAtRetirement / parado.productiveAtRetirement,
    1e-9,
  );

  // 400 mil a 2% reais ao ano por 35 anos.
  closeTo(valoriza.productiveAtRetirement, 400_000 * Math.pow(1.02, 35), 1);
});

test('valorização real zero mantém o poder de compra do bem', () => {
  const result = project(comImovel);
  closeTo(result.productiveAtRetirement, 400_000, 1e-6);
  closeTo(result.passiveAtRetirement, 2_000, 1e-9);
});

test('o aporte necessário fecha a conta mesmo com renda passiva reinvestida', () => {
  // Meta alta o bastante para a carteira ainda ter trabalho depois do aluguel.
  const magro = { ...comImovel, monthlyContribution: 50, desiredMonthlyIncome: 30_000 };
  const result = project(magro);
  assert.equal(result.onTrack, false);

  const corrigido = project({ ...magro, monthlyContribution: result.requiredMonthlyContribution });
  assert.equal(corrigido.onTrack, true);
  closeTo(corrigido.sustainableIncome, corrigido.neededFromPortfolio, 1e-6);
});

test('o aporte necessário fecha a conta também quando o bem é vendido', () => {
  const magro = {
    ...comImovel,
    monthlyContribution: 50,
    desiredMonthlyIncome: 30_000,
    sellProductiveAtRetirement: true,
  };
  const result = project(magro);
  assert.equal(result.onTrack, false);

  const corrigido = project({ ...magro, monthlyContribution: result.requiredMonthlyContribution });
  assert.equal(corrigido.onTrack, true);
  closeTo(corrigido.balanceAtRetirement, corrigido.targetBalance, 1e-6);
});

test('o bem mantido soma à herança, mas não ao alvo da carteira', () => {
  const result = project({ ...comImovel, legacy: 0 });

  closeTo(result.productiveAtEnd, 400_000, 1e-6);
  closeTo(result.estateAtEnd, result.legacyAtEnd + 400_000, 1e-6);
  // A carteira segue zerando no fim: o alvo não conta com o imóvel.
  closeTo(result.legacyAtEnd, 0, 1e-4);
});

test('productiveSeries acompanha balanceSeries mês a mês', () => {
  const result = project(comImovel);
  assert.equal(result.productiveSeries.length, result.balanceSeries.length);
  closeTo(result.productiveSeries[0], 400_000, 1e-9);
  closeTo(result.productiveSeries[result.accumulationMonths], 400_000, 1e-6);
});

test('flowSeries inclui a renda passiva reinvestida', () => {
  const reinveste = project(comImovel);
  const consome = project({ ...comImovel, reinvestPassiveIncome: false });

  // No primeiro mês entram o aporte e a renda passiva.
  closeTo(reinveste.flowSeries[1], basePlan.monthlyContribution + 2_000);
  closeTo(consome.flowSeries[1], basePlan.monthlyContribution);
});

test('renda passiva suficiente dispensa a carteira por completo', () => {
  const result = project({ ...comImovel, passiveIncome: 9_000 });
  assert.equal(result.neededFromPortfolio, 0);
  assert.equal(result.targetBalance, 0);
  assert.equal(result.onTrack, true);
  assert.equal(result.requiredMonthlyContribution, 0);
});

test('validate rejeita patrimônio produtivo e renda passiva negativos', () => {
  assert.deepEqual(validate(comImovel), []);
  assert.ok(validate({ ...comImovel, productiveAssets: -1 }).length > 0);
  assert.ok(validate({ ...comImovel, passiveIncome: -1 }).length > 0);
});
