/**
 * Análises derivadas da projeção.
 *
 * Enquanto `retirement.js` responde "como fica o meu plano", este módulo
 * responde as perguntas que vêm depois: qual alavanca importa mais, quando eu
 * poderia parar, se a retirada é sustentável e o que acontece se o mercado cair
 * bem na hora errada.
 *
 * Tudo aqui é puro e opera chamando `project` repetidamente sobre variações do
 * plano — nenhuma fórmula financeira é reimplementada.
 */

import {
  annualToMonthly,
  project,
  realAnnualRate,
  sustainableWithdrawal,
  validate,
} from './retirement.js';

/** Retirada de referência do mercado para uma aposentadoria de ~30 anos. */
export const SAFE_WITHDRAWAL_BENCHMARK = 0.04;

/**
 * Projeta uma variação do plano, ou `null` se a variação for inválida.
 * @param {object} plan plano base
 * @param {object} patch campos a sobrescrever
 * @returns {object|null} resultado da projeção
 */
function projectVariant(plan, patch) {
  const variant = { ...plan, ...patch };
  return validate(variant).length > 0 ? null : project(variant);
}

/**
 * Mede quanto cada alavanca move a renda mensal projetada.
 *
 * É a análise que responde "onde eu mexo primeiro?" — quase sempre a resposta
 * surpreende, porque adiar a aposentadoria costuma pesar mais que aportar mais.
 *
 * @param {object} plan plano base
 * @returns {{baseIncome: number, levers: Array<{id: string, label: string,
 *   income: number, delta: number}>}} alavancas ordenadas por impacto absoluto
 */
export function sensitivity(plan) {
  const base = project(plan);
  const baseIncome = base.projectedMonthlyIncome;

  const candidates = [
    { id: 'retire-later', label: 'Aposentar 2 anos mais tarde', patch: { retirementAge: plan.retirementAge + 2 } },
    { id: 'retire-earlier', label: 'Aposentar 2 anos mais cedo', patch: { retirementAge: plan.retirementAge - 2 } },
    {
      id: 'contribute-more',
      label: 'Aportar 20% a mais',
      patch: { monthlyContribution: plan.monthlyContribution * 1.2 },
    },
    {
      id: 'return-up',
      label: 'Render 1 p.p. a mais ao ano',
      patch: {
        accumulationReturn: plan.accumulationReturn + 0.01,
        retirementReturn: plan.retirementReturn + 0.01,
      },
    },
    {
      id: 'return-down',
      label: 'Render 1 p.p. a menos ao ano',
      patch: {
        accumulationReturn: plan.accumulationReturn - 0.01,
        retirementReturn: plan.retirementReturn - 0.01,
      },
    },
    { id: 'inflation-up', label: 'Inflação 1 p.p. maior', patch: { inflation: plan.inflation + 0.01 } },
    { id: 'live-longer', label: 'Viver 5 anos a mais', patch: { endAge: plan.endAge + 5 } },
  ];

  const levers = candidates
    .map(({ id, label, patch }) => {
      const result = projectVariant(plan, patch);
      if (result === null) return null;
      return { id, label, income: result.projectedMonthlyIncome, delta: result.projectedMonthlyIncome - baseIncome };
    })
    .filter((lever) => lever !== null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { baseIncome, levers };
}

/**
 * Idade mais cedo em que o plano ainda atinge a meta, mantido o aporte atual.
 *
 * Adiar a aposentadoria melhora o plano por dois caminhos ao mesmo tempo — mais
 * meses acumulando e menos meses a sustentar — então a viabilidade é monótona na
 * idade e uma busca binária basta.
 *
 * @param {object} plan plano base
 * @returns {number|null} idade, ou `null` se a meta não é atingida em idade alguma
 */
export function earliestFeasibleRetirementAge(plan) {
  const lowest = Math.floor(plan.currentAge) + 1;
  const highest = Math.floor(plan.endAge) - 1;
  if (lowest > highest) return null;

  const feasible = (age) => {
    const result = projectVariant(plan, { retirementAge: age });
    return result !== null && result.onTrack;
  };

  if (!feasible(highest)) return null;

  let low = lowest;
  let high = highest;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (feasible(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Taxa de retirada do primeiro ano, comparada à referência de 4%.
 *
 * Uma taxa muito acima da referência sinaliza que o plano depende de o mercado
 * colaborar; abaixo dela, sobra folga.
 *
 * @param {object} result resultado de `project`
 * @returns {{rate: number, benchmark: number, ratio: number}|null}
 *   `null` quando não há patrimônio de onde retirar
 */
export function withdrawalRate(result) {
  if (!(result.balanceAtRetirement > 0)) return null;
  const rate = (result.sustainableIncome * 12) / result.balanceAtRetirement;
  return {
    rate,
    benchmark: SAFE_WITHDRAWAL_BENCHMARK,
    ratio: rate / SAFE_WITHDRAWAL_BENCHMARK,
  };
}

/**
 * Efeito de uma queda de mercado no ano da aposentadoria.
 *
 * É o risco de sequência de retornos: a mesma rentabilidade média machuca muito
 * mais quando as perdas chegam logo no começo do usufruto, porque o saque
 * acontece sobre um patrimônio já reduzido.
 *
 * @param {object} plan plano base
 * @param {number[]} [drops] quedas a simular, em decimal
 * @returns {Array<{drop: number, balance: number, income: number, loss: number}>}
 */
export function crashScenarios(plan, drops = [0.1, 0.2, 0.3]) {
  const base = project(plan);
  const monthlyRate = annualToMonthly(realAnnualRate(plan.retirementReturn, plan.inflation));

  return drops.map((drop) => {
    // A queda atinge a carteira financeira no instante da aposentadoria; o que
    // vem de INSS e de aluguel não some junto, então segue somando por fora.
    const balance = base.balanceAtRetirement * (1 - drop);
    const fromPortfolio = sustainableWithdrawal({
      balance,
      monthlyRate,
      months: base.retirementMonths,
      legacy: plan.legacy ?? 0,
    });
    const income = fromPortfolio + base.supplementalIncome;

    return {
      drop,
      balance,
      income,
      loss: base.projectedMonthlyIncome - income,
      // Fração da meta que ainda seria atendida depois da queda.
      coverage: plan.desiredMonthlyIncome > 0 ? income / plan.desiredMonthlyIncome : 1,
    };
  });
}

/**
 * De onde vem cada real da renda mensal na aposentadoria.
 * @param {object} result resultado de `project`
 * @param {object} plan plano base
 * @returns {{total: number, sources: Array<{id: string, label: string, value: number}>}}
 */
export function incomeSources(result, plan) {
  const sources = [
    { id: 'portfolio', label: 'Carteira', value: result.sustainableIncome },
    { id: 'other', label: 'INSS e outras', value: plan.otherMonthlyIncome ?? 0 },
    { id: 'passive', label: 'Renda passiva', value: result.passiveDuringRetirement },
  ].filter((source) => source.value > 0);

  return { total: sources.reduce((sum, source) => sum + source.value, 0), sources };
}
