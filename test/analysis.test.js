import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SAFE_WITHDRAWAL_BENCHMARK,
  crashScenarios,
  earliestFeasibleRetirementAge,
  incomeSources,
  sensitivity,
  withdrawalRate,
} from '../src/analysis.js';
import { project } from '../src/retirement.js';

const closeTo = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected}, recebido ${actual} (tolerância ${tolerance})`,
  );

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

/* ---------- Taxa de retirada ---------- */

test('withdrawalRate é a retirada anual sobre o patrimônio', () => {
  const result = project(basePlan);
  const { rate, benchmark } = withdrawalRate(result);

  closeTo(rate, (result.sustainableIncome * 12) / result.balanceAtRetirement, 1e-12);
  assert.equal(benchmark, SAFE_WITHDRAWAL_BENCHMARK);
});

test('withdrawalRate sinaliza folga ou aperto pela razão com a referência', () => {
  // Aposentadoria curta permite sacar bem acima dos 4%.
  const curta = withdrawalRate(project({ ...basePlan, endAge: 72 }));
  assert.ok(curta.ratio > 1);

  // Aposentadoria longa força uma retirada bem mais conservadora.
  const longa = withdrawalRate(project({ ...basePlan, endAge: 110 }));
  assert.ok(longa.rate < curta.rate);
});

test('withdrawalRate devolve null sem patrimônio', () => {
  const semNada = project({ ...basePlan, initialBalance: 0, monthlyContribution: 0 });
  assert.equal(withdrawalRate(semNada), null);
});

/* ---------- Idade mais cedo viável ---------- */

test('earliestFeasibleRetirementAge acha a primeira idade que fecha o plano', () => {
  const idade = earliestFeasibleRetirementAge(basePlan);
  assert.ok(Number.isInteger(idade));

  // Nessa idade fecha...
  assert.equal(project({ ...basePlan, retirementAge: idade }).onTrack, true);
  // ...e um ano antes, não.
  assert.equal(project({ ...basePlan, retirementAge: idade - 1 }).onTrack, false);
});

test('earliestFeasibleRetirementAge devolve null quando a meta é inalcançável', () => {
  assert.equal(
    earliestFeasibleRetirementAge({
      ...basePlan,
      monthlyContribution: 0,
      initialBalance: 0,
      desiredMonthlyIncome: 100_000,
    }),
    null,
  );
});

test('earliestFeasibleRetirementAge respeita a monotonicidade da viabilidade', () => {
  const idade = earliestFeasibleRetirementAge(basePlan);
  // Adiar sempre ajuda: mais meses acumulando e menos meses a sustentar.
  for (let age = idade; age <= basePlan.endAge - 1; age++) {
    assert.equal(project({ ...basePlan, retirementAge: age }).onTrack, true, `falhou aos ${age}`);
  }
});

/* ---------- Sensibilidade ---------- */

test('sensitivity mede o desvio de cada alavanca sobre a renda projetada', () => {
  const { baseIncome, levers } = sensitivity(basePlan);
  closeTo(baseIncome, project(basePlan).projectedMonthlyIncome, 1e-9);

  for (const lever of levers) closeTo(lever.delta, lever.income - baseIncome, 1e-9);
});

test('sensitivity ordena por impacto absoluto', () => {
  const { levers } = sensitivity(basePlan);
  const magnitudes = levers.map((lever) => Math.abs(lever.delta));
  assert.deepEqual(magnitudes, [...magnitudes].sort((a, b) => b - a));
});

test('sensitivity acerta o sinal de cada alavanca', () => {
  const byId = Object.fromEntries(sensitivity(basePlan).levers.map((l) => [l.id, l]));

  assert.ok(byId['retire-later'].delta > 0);
  assert.ok(byId['retire-earlier'].delta < 0);
  assert.ok(byId['contribute-more'].delta > 0);
  assert.ok(byId['return-up'].delta > 0);
  assert.ok(byId['return-down'].delta < 0);
  assert.ok(byId['inflation-up'].delta < 0);
  // Viver mais dilui o mesmo patrimônio por mais meses.
  assert.ok(byId['live-longer'].delta < 0);
});

test('sensitivity descarta variações que não formam um plano válido', () => {
  // Aos 64 indo para 65, "aposentar 2 anos mais cedo" cairia antes da idade atual.
  const { levers } = sensitivity({ ...basePlan, currentAge: 64 });
  assert.ok(!levers.some((lever) => lever.id === 'retire-earlier'));
  assert.ok(levers.some((lever) => lever.id === 'retire-later'));
});

/* ---------- Queda de mercado ---------- */

test('crashScenarios reduz só a carteira, preservando INSS e renda passiva', () => {
  const base = project(basePlan);
  const [dez] = crashScenarios(basePlan, [0.1]);

  closeTo(dez.balance, base.balanceAtRetirement * 0.9, 1e-6);
  // A renda cai na proporção da carteira; o INSS entra inteiro por cima.
  closeTo(dez.income, base.sustainableIncome * 0.9 + base.supplementalIncome, 1e-6);
});

test('crashScenarios sem queda reproduz o plano original', () => {
  const base = project(basePlan);
  const [zero] = crashScenarios(basePlan, [0]);
  closeTo(zero.income, base.projectedMonthlyIncome, 1e-6);
  closeTo(zero.loss, 0, 1e-6);
});

test('crashScenarios piora monotonicamente com a queda', () => {
  const cenarios = crashScenarios(basePlan, [0.1, 0.2, 0.3]);
  for (let i = 1; i < cenarios.length; i++) {
    assert.ok(cenarios[i].income < cenarios[i - 1].income);
    assert.ok(cenarios[i].loss > cenarios[i - 1].loss);
  }
});

test('crashScenarios mede a cobertura da meta', () => {
  const [queda] = crashScenarios(basePlan, [0.3]);
  closeTo(queda.coverage, queda.income / basePlan.desiredMonthlyIncome, 1e-9);
});

test('crashScenarios respeita a herança planejada', () => {
  // Com herança a preservar, a renda não é mais proporcional ao saldo.
  const comHeranca = { ...basePlan, legacy: 400_000 };
  const base = project(comHeranca);
  const [queda] = crashScenarios(comHeranca, [0.2]);
  assert.ok(queda.income < base.sustainableIncome * 0.8 + base.supplementalIncome);
});

/* ---------- Fontes de renda ---------- */

test('incomeSources soma exatamente a renda projetada', () => {
  const result = project(basePlan);
  const { total, sources } = incomeSources(result, basePlan);
  closeTo(total, result.projectedMonthlyIncome, 1e-9);
  assert.deepEqual(sources.map((s) => s.id), ['portfolio', 'other']);
});

test('incomeSources inclui a renda passiva quando existe', () => {
  const plano = { ...basePlan, productiveAssets: 400_000, passiveIncome: 2_500 };
  const { sources, total } = incomeSources(project(plano), plano);
  assert.deepEqual(sources.map((s) => s.id), ['portfolio', 'other', 'passive']);
  closeTo(total, project(plano).projectedMonthlyIncome, 1e-9);
});

test('incomeSources omite fontes zeradas', () => {
  const plano = { ...basePlan, otherMonthlyIncome: 0 };
  assert.deepEqual(incomeSources(project(plano), plano).sources.map((s) => s.id), ['portfolio']);
});
