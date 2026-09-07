/**
 * Camada de interface.
 *
 * Lê o formulário, chama o motor (`retirement.js`) e as análises
 * (`analysis.js`), e entrega o resultado aos gráficos (`charts.js`). Nenhuma
 * regra financeira mora aqui — só apresentação e animação.
 */

import { project, validate } from './retirement.js';
import {
  crashScenarios,
  earliestFeasibleRetirementAge,
  incomeSources,
  sensitivity,
  withdrawalRate,
} from './analysis.js';
import {
  drawCrashScenarios,
  drawIncomeMix,
  drawSensitivity,
  drawWealthChart,
  prefersReducedMotion,
} from './charts.js';
import { anos, money, moneyUp, pct } from './format.js';

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { $(id).textContent = value; };

/* ---------- Números animados ---------- */

/**
 * Anima um valor numérico até o novo alvo.
 *
 * O valor corrente fica guardado no próprio elemento, então digitar rápido
 * encadeia as transições em vez de fazer o número piscar. Com movimento
 * reduzido, escreve direto.
 *
 * @param {string} id id do elemento
 * @param {number} value valor alvo
 * @param {(n: number) => string} format formatador
 */
function setNumber(id, value, format = money) {
  const element = $(id);
  const from = Number.isFinite(element._value) ? element._value : null;

  if (element._frame) cancelAnimationFrame(element._frame);

  if (from === null || !Number.isFinite(value) || prefersReducedMotion() || from === value) {
    element._value = value;
    element.textContent = format(value);
    return;
  }

  const duration = 420;
  const start = performance.now();
  // Desaceleração cúbica: rápida no começo, assentando no fim.
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const current = from + (value - from) * ease(progress);
    element.textContent = format(current);
    if (progress < 1) element._frame = requestAnimationFrame(step);
    else {
      element._value = value;
      element.textContent = format(value);
      element._frame = null;
    }
  };
  element._frame = requestAnimationFrame(step);
}

/* ---------- Leitura do formulário ---------- */

const FIELDS = [
  'currentAge', 'retirementAge', 'endAge', 'initialBalance', 'monthlyContribution',
  'accumulationReturn', 'retirementReturn', 'inflation',
  'desiredMonthlyIncome', 'otherMonthlyIncome', 'legacy',
  'productiveAssets', 'passiveIncome', 'productiveRealGrowth',
];
const SWITCHES = ['indexContribution', 'reinvestPassiveIncome', 'sellProductiveAtRetirement'];

const DEFAULTS = Object.fromEntries(FIELDS.map((id) => [id, $(id).value]));
const SWITCH_DEFAULTS = Object.fromEntries(SWITCHES.map((id) => [id, $(id).checked]));
const STORE_KEY = 'plano-aposentadoria';

const num = (id) => {
  const value = Number.parseFloat($(id).value);
  return Number.isFinite(value) ? value : Number.NaN;
};

const readPlan = () => ({
  currentAge: Math.round(num('currentAge')),
  retirementAge: Math.round(num('retirementAge')),
  endAge: Math.round(num('endAge')),
  initialBalance: num('initialBalance'),
  monthlyContribution: num('monthlyContribution'),
  accumulationReturn: num('accumulationReturn') / 100,
  retirementReturn: num('retirementReturn') / 100,
  inflation: num('inflation') / 100,
  indexContribution: $('indexContribution').checked,
  desiredMonthlyIncome: num('desiredMonthlyIncome'),
  otherMonthlyIncome: num('otherMonthlyIncome'),
  legacy: num('legacy'),
  productiveAssets: num('productiveAssets'),
  passiveIncome: num('passiveIncome'),
  productiveRealGrowth: num('productiveRealGrowth') / 100,
  reinvestPassiveIncome: $('reinvestPassiveIncome').checked,
  sellProductiveAtRetirement: $('sellProductiveAtRetirement').checked,
});

/** Conveniência por leitor: guarda o que foi digitado neste navegador. */
function save() {
  try {
    const state = Object.fromEntries(FIELDS.map((id) => [id, $(id).value]));
    for (const id of SWITCHES) state[id] = $(id).checked;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* modo privado ou armazenamento bloqueado: seguir sem salvar */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    for (const id of FIELDS) if (typeof state[id] === 'string') $(id).value = state[id];
    for (const id of SWITCHES) if (typeof state[id] === 'boolean') $(id).checked = state[id];
  } catch { /* estado inválido: manter os valores padrão */ }
}

/* ---------- Blocos ---------- */

function renderVerdict(result, plan) {
  const verdict = $('verdict');
  const surplus = result.projectedMonthlyIncome - plan.desiredMonthlyIncome;

  if (result.neededFromPortfolio === 0) {
    verdict.dataset.state = 'good';
    setText('verdict-title', 'Suas rendas fora da carteira já cobrem a meta');
    setText('verdict-detail',
      `${money(result.supplementalIncome)} por mês entre INSS, aluguéis e outras fontes já ` +
      `atendem os ${money(plan.desiredMonthlyIncome)} desejados. Tudo que acumular vira folga.`);
    return;
  }

  if (result.onTrack) {
    verdict.dataset.state = 'good';
    setText('verdict-title', 'Seu plano chega lá');
    setText('verdict-detail',
      `Mantendo ${money(plan.monthlyContribution)} por mês, aos ${plan.retirementAge} anos você terá ` +
      `${money(result.balanceAtRetirement)} e uma renda de ${money(result.projectedMonthlyIncome)} por mês — ` +
      `${money(Math.abs(surplus))} ${surplus >= 0 ? 'acima' : 'abaixo'} da meta, com o dinheiro durando ` +
      `até os ${plan.endAge} anos.`);
    return;
  }

  verdict.dataset.state = 'short';
  setText('verdict-title', `Faltam ${moneyUp(result.gap)} de patrimônio`);

  const fix = Number.isFinite(result.requiredMonthlyContribution)
    ? `Aportar ${moneyUp(result.requiredMonthlyContribution)} por mês ` +
      `(${moneyUp(result.additionalMonthlyContribution)} a mais) fecha a conta.`
    : 'Com retorno real nulo ou negativo, aumentar o aporte não resolve sozinho: reveja as premissas.';

  const ends = result.depletionAge === null ? ''
    : ` Mantendo a retirada desejada, o dinheiro acabaria aos ${Math.floor(result.depletionAge)} anos.`;

  setText('verdict-detail',
    `Sua renda projetada é ${money(result.projectedMonthlyIncome)} por mês, contra ` +
    `${money(plan.desiredMonthlyIncome)} desejados. ${fix}${ends}`);
}

function renderMetrics(result, plan, earliest) {
  $('m-income').dataset.tone = result.onTrack ? 'good' : 'short';
  setNumber('v-income', result.projectedMonthlyIncome);

  const sources = [`carteira ${money(result.sustainableIncome)}`];
  if (plan.otherMonthlyIncome > 0) sources.push(`INSS ${money(plan.otherMonthlyIncome)}`);
  if (result.passiveDuringRetirement > 0) sources.push(`passiva ${money(result.passiveDuringRetirement)}`);
  setText('n-income', `Meta ${money(plan.desiredMonthlyIncome)} · ${sources.join(' + ')}`);

  setNumber('v-balance', result.balanceAtRetirement);
  setText('n-balance', result.productiveAtEnd > 0
    ? `Em ${anos(plan.retirementAge - plan.currentAge)} · mais ${money(result.productiveAtRetirement)} em bens`
    : `Em ${anos(plan.retirementAge - plan.currentAge)}, em valores de hoje`);

  setNumber('v-target', result.targetBalance, moneyUp);
  setText('n-target', result.onTrack
    ? `Sobra de ${money(-result.gap)}`
    : `Faltam ${moneyUp(result.gap)}`);

  // Parar antes do planejado é boa notícia; ter de adiar, não.
  const earliestCard = $('m-earliest');
  if (earliest === null) {
    earliestCard.dataset.tone = 'short';
    $('v-earliest').textContent = '—';
    $('v-earliest')._value = null;
    setText('n-earliest', 'A meta não é atingida em nenhuma idade com o aporte atual');
    return;
  }
  earliestCard.dataset.tone = earliest <= plan.retirementAge ? 'good' : 'short';
  setNumber('v-earliest', earliest, (value) => `${Math.round(value)} anos`);
  setText('n-earliest', earliest < plan.retirementAge
    ? `${anos(plan.retirementAge - earliest)} antes do que você planejou`
    : earliest === plan.retirementAge
      ? 'Exatamente a idade que você planejou'
      : `${anos(earliest - plan.retirementAge)} depois do que você planejou`);
}

function renderWealthComposition(result, plan) {
  const initial = Math.max(0, plan.initialBalance);
  const paid = Math.max(0, result.totalContributed);
  const passive = Math.max(0, result.totalPassiveReinvested);
  const growth = Math.max(0, result.investmentGrowth);
  const total = initial + paid + passive + growth || 1;

  const share = (value) => `${(value / total) * 100}%`;
  $('s-initial').style.flexBasis = share(initial);
  $('s-paid').style.flexBasis = share(paid);
  $('s-passive').style.flexBasis = share(passive);
  $('s-growth').style.flexBasis = share(growth);

  setNumber('v-initial', initial);
  setNumber('v-paid', paid);
  setNumber('v-passive', passive);
  setNumber('v-growth', result.investmentGrowth);
  $('part-passive').hidden = passive <= 0;
}

function renderRate(result) {
  const rate = withdrawalRate(result);
  if (rate === null) {
    setText('v-rate', '—');
    $('rate-needle').style.left = '0%';
    setText('rate-caption', 'Sem patrimônio acumulado não há retirada a medir.');
    return;
  }

  setNumber('v-rate', rate.rate, pct);
  // A escala vai de 0% a 8%; acima disso o ponteiro encosta na ponta.
  $('rate-needle').style.left = `${Math.min(rate.rate / 0.08, 1) * 100}%`;

  const compare = rate.ratio > 1.15
    ? `Acima da referência de 4% — o plano depende de o mercado colaborar, ou de a aposentadoria ser mais curta.`
    : rate.ratio < 0.85
      ? `Abaixo da referência de 4% — há folga para gastar mais ou deixar mais herança.`
      : `Em linha com a referência de 4% usada para aposentadorias de cerca de 30 anos.`;
  setText('rate-caption', `Você retiraria ${pct(rate.rate)} do patrimônio no primeiro ano. ${compare}`);
}

function renderTable(result, plan) {
  const lastMonth = result.balanceSeries.length - 1;
  const rows = [];

  // A coluna do bem só aparece quando há um: uma coluna de zeros é ruído.
  const showProductive = result.productiveSeries.some((value) => value > 0);
  $('th-productive').hidden = !showProductive;

  for (let start = 0; start < lastMonth; start += 12) {
    const end = Math.min(start + 12, lastMonth);
    let flow = 0;
    for (let month = start + 1; month <= end; month++) flow += result.flowSeries[month];

    const closing = result.balanceSeries[end];
    const growth = closing - result.balanceSeries[start] - flow;
    const retired = start >= result.accumulationMonths;

    const row = document.createElement('tr');
    row.dataset.phase = retired ? 'retirement' : 'accumulation';

    const cells = [
      [String(plan.currentAge + end / 12), false],
      [retired ? 'Aposentadoria' : 'Acumulação', false],
      [money(flow), flow < 0],
      [money(growth), growth < 0],
      [money(closing), false],
    ];
    if (showProductive) cells.push([money(result.productiveSeries[end]), false]);

    for (const [value, debit] of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (debit) cell.classList.add('debit');
      row.append(cell);
    }
    rows.push(row);
  }
  $('rows').replaceChildren(...rows);
}

function renderAssumptions(result, plan) {
  const rows = [
    ['Tempo até a aposentadoria', anos(plan.retirementAge - plan.currentAge)],
    ['Duração da aposentadoria', anos(plan.endAge - plan.retirementAge)],
    ['Retorno real na acumulação', pct(result.realAccumulationReturn)],
    ['Retorno real na aposentadoria', pct(result.realRetirementReturn)],
    ['Inflação considerada', pct(plan.inflation)],
    ['Aporte corrigido pela inflação', plan.indexContribution ? 'Sim' : 'Não'],
    ['Herança planejada', money(plan.legacy)],
    ['Saldo da carteira ao fim', money(result.legacyAtEnd)],
  ];

  if (plan.productiveAssets > 0 || plan.passiveIncome > 0) {
    rows.push(
      ['Patrimônio produtivo ao se aposentar', money(result.productiveAtRetirement)],
      ['Renda passiva ao se aposentar', money(result.passiveAtRetirement)],
      ['Renda passiva na aposentadoria', money(result.passiveDuringRetirement)],
      ['Renda passiva reinvestida', money(result.totalPassiveReinvested)],
      ['Patrimônio total deixado', money(result.estateAtEnd)],
    );
  }

  $('assumptions').replaceChildren(...rows.map(([label, value]) => {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    wrapper.append(term, definition);
    return wrapper;
  }));
}

/* ---------- Orquestração ---------- */

let firstRender = true;

function render() {
  const plan = readPlan();
  const errors = validate(plan);

  if (errors.length > 0) {
    $('error-list').replaceChildren(...errors.map((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    }));
    $('errors').hidden = false;
    $('results').style.opacity = '0.45';
    return;
  }

  $('errors').hidden = true;
  $('results').style.opacity = '1';

  const result = project(plan);
  const earliest = earliestFeasibleRetirementAge(plan);

  renderVerdict(result, plan);
  renderMetrics(result, plan, earliest);
  renderWealthComposition(result, plan);
  renderRate(result);
  renderTable(result, plan);
  renderAssumptions(result, plan);

  const { hasProductive } = drawWealthChart($('chart'), result, plan, {
    animate: firstRender,
    title: $('chart-desc'),
  });
  $('key-productive').hidden = !hasProductive;

  setText('chart-caption', result.depletionAge === null
    ? `O patrimônio sustenta ${money(result.sustainableIncome)} por mês até os ${plan.endAge} anos.`
    : `Retirando os ${money(result.neededFromPortfolio)} mensais desejados da carteira, o saldo ` +
      `zeraria aos ${Math.floor(result.depletionAge)} anos.`);

  drawIncomeMix($('mix'), $('mix-list'), incomeSources(result, plan));

  const levers = sensitivity(plan);
  drawSensitivity($('levers'), levers);
  const strongest = levers.levers[0];
  setText('levers-caption', strongest
    ? `A alavanca mais forte é "${strongest.label.toLowerCase()}": sozinha, move ` +
      `${money(Math.abs(strongest.delta))} por mês.`
    : '');

  const crashes = crashScenarios(plan);
  drawCrashScenarios($('crashes'), crashes, plan.desiredMonthlyIncome);
  const survived = crashes.filter((scenario) => scenario.coverage >= 1).length;
  setText('crashes-caption', survived === crashes.length
    ? 'O plano continua atendendo a meta mesmo com uma queda de 30% logo na largada.'
    : survived === 0
      ? 'Qualquer uma dessas quedas já derrubaria a renda abaixo da meta.'
      : `A meta resiste até uma queda de ${Math.round(crashes[survived - 1].drop * 100)}%; ` +
        `além disso, a renda fica abaixo do desejado.`);

  firstRender = false;
}

$('form').addEventListener('input', () => { render(); save(); });

$('reset').addEventListener('click', () => {
  for (const id of FIELDS) $(id).value = DEFAULTS[id];
  for (const id of SWITCHES) $(id).checked = SWITCH_DEFAULTS[id];
  render();
  save();
});

// O gráfico mapeia pixels do ponteiro; redesenhar mantém a leitura correta.
window.addEventListener('resize', render);

restore();
render();
