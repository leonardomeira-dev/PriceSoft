/**
 * Camada de interface da calculadora de aposentadoria.
 *
 * Lê o formulário, chama o motor de cálculo em `retirement.js` e desenha os
 * resultados: cartões, gráfico SVG, composição do patrimônio e tabela anual.
 * Nenhuma regra financeira mora aqui — só apresentação.
 */

import { project, validate } from './retirement.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------- Formatação ---------- */

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

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 2,
});

/** Formata um valor monetário, protegendo contra resultados não finitos. */
const money = (value) => (Number.isFinite(value) ? currency.format(value) : '—');

/** Formata uma quantidade de anos com a concordância correta. */
const years = (count) => `${count} ${count === 1 ? 'ano' : 'anos'}`;

/* ---------- Elementos ---------- */

const form = document.getElementById('plan-form');
const errorBox = document.getElementById('errors');
const errorList = document.getElementById('error-list');
const results = document.getElementById('results');
const chart = document.getElementById('chart');
const chartTitle = document.getElementById('chart-title');

const text = (id, value) => {
  document.getElementById(id).textContent = value;
};

/* ---------- Leitura do formulário ---------- */

const number = (name) => {
  const value = Number.parseFloat(form.elements[name].value);
  return Number.isFinite(value) ? value : Number.NaN;
};

/** Percentuais entram como 9 (por cento) e saem como 0.09 (decimal). */
const rate = (name) => number(name) / 100;

/** Monta o objeto de plano esperado por `project` a partir do formulário. */
function readPlan() {
  return {
    currentAge: Math.round(number('currentAge')),
    retirementAge: Math.round(number('retirementAge')),
    endAge: Math.round(number('endAge')),
    initialBalance: number('initialBalance'),
    monthlyContribution: number('monthlyContribution'),
    accumulationReturn: rate('accumulationReturn'),
    retirementReturn: rate('retirementReturn'),
    inflation: rate('inflation'),
    indexContribution: form.elements.indexContribution.checked,
    desiredMonthlyIncome: number('desiredMonthlyIncome'),
    otherMonthlyIncome: number('otherMonthlyIncome'),
    legacy: number('legacy'),
  };
}

/* ---------- Gráfico ---------- */

const VIEW = { width: 860, height: 320 };
const PAD = { top: 16, right: 18, bottom: 34, left: 88 };
const PLOT = {
  width: VIEW.width - PAD.left - PAD.right,
  height: VIEW.height - PAD.top - PAD.bottom,
};

/** Cria um elemento SVG com atributos e, opcionalmente, conteúdo textual. */
function svgEl(name, attributes = {}, textContent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

/**
 * Arredonda um valor para cima até um número "redondo" (1, 2, 2,5 ou 5 vezes
 * uma potência de dez), para que o eixo vertical tenha marcações legíveis.
 */
function niceCeil(value) {
  if (!(value > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Escolhe um intervalo inteiro de anos que gere ~6 marcações no eixo horizontal. */
function ageStep(totalYears) {
  for (const candidate of [5, 10, 15, 20, 25]) {
    if (totalYears / candidate <= 7) return candidate;
  }
  return 30;
}

/**
 * Reduz a série mensal a pontos anuais, garantindo que o mês da aposentadoria e
 * o último mês estejam presentes mesmo quando não caem numa amostra anual.
 */
function samplePoints(result, plan) {
  const lastMonth = result.balanceSeries.length - 1;
  const months = new Set([result.accumulationMonths, lastMonth]);
  for (let month = 0; month <= lastMonth; month += 12) months.add(month);

  return [...months]
    .sort((a, b) => a - b)
    .map((month) => ({
      month,
      age: plan.currentAge + month / 12,
      value: result.balanceSeries[month],
    }));
}

function renderChart(result, plan) {
  chart.replaceChildren(chartTitle);

  const points = samplePoints(result, plan);
  const maxValue = niceCeil(Math.max(...points.map((point) => point.value), 1));
  const startAge = plan.currentAge;
  const spanYears = Math.max(plan.endAge - plan.currentAge, 1);

  const x = (age) => PAD.left + ((age - startAge) / spanYears) * PLOT.width;
  const y = (value) => PAD.top + PLOT.height - (value / maxValue) * PLOT.height;
  const baseline = PAD.top + PLOT.height;

  const layer = svgEl('g');

  // Linhas de grade e rótulos do eixo vertical.
  for (let index = 0; index <= 4; index++) {
    const value = (maxValue / 4) * index;
    const lineY = y(value);
    layer.append(
      svgEl('line', {
        class: index === 0 ? 'axis-line' : 'grid-line',
        x1: PAD.left,
        x2: PAD.left + PLOT.width,
        y1: lineY,
        y2: lineY,
      }),
      svgEl(
        'text',
        { class: 'axis-label', x: PAD.left - 8, y: lineY + 4, 'text-anchor': 'end' },
        index === 0 ? '0' : currencyCompact.format(value),
      ),
    );
  }

  // Rótulos do eixo horizontal, em idades redondas. A idade final é sempre
  // marcada; se a marcação regular cair perto demais dela, é descartada para não
  // sobrepor os dois rótulos.
  const step = ageStep(spanYears);
  const ticks = [];
  for (let age = startAge; age < plan.endAge; age += step) ticks.push(age);
  if (ticks.length > 1 && plan.endAge - ticks[ticks.length - 1] < step * 0.6) ticks.pop();
  ticks.push(plan.endAge);

  ticks.forEach((age, index) => {
    const isLast = index === ticks.length - 1;
    layer.append(
      svgEl(
        'text',
        {
          class: 'axis-label',
          x: x(age),
          y: baseline + 20,
          'text-anchor': isLast ? 'end' : 'middle',
        },
        isLast ? `${Math.round(age)} anos` : String(Math.round(age)),
      ),
    );
  });

  // Áreas e linhas das duas fases. O ponto da aposentadoria entra nas duas para
  // que as curvas se encontrem sem degrau.
  const accumulation = points.filter((point) => point.month <= result.accumulationMonths);
  const retirement = points.filter((point) => point.month >= result.accumulationMonths);

  const toPath = (list) => list.map((point) => `${x(point.age)},${y(point.value)}`).join(' L ');

  const addPhase = (list, areaClass, lineClass) => {
    if (list.length < 2) return;
    const path = toPath(list);
    const first = list[0];
    const last = list[list.length - 1];
    layer.append(
      svgEl('path', {
        class: areaClass,
        d: `M ${x(first.age)},${baseline} L ${path} L ${x(last.age)},${baseline} Z`,
      }),
      svgEl('path', { class: lineClass, d: `M ${path}` }),
    );
  };

  addPhase(accumulation, 'area-accumulation', 'line-accumulation');
  addPhase(retirement, 'area-retirement', 'line-retirement');

  // Marcador da aposentadoria.
  const retirementX = x(plan.retirementAge);
  layer.append(
    svgEl('line', { class: 'marker-line', x1: retirementX, x2: retirementX, y1: PAD.top, y2: baseline }),
    svgEl(
      'text',
      {
        class: 'marker-label',
        x: retirementX + (retirementX > PAD.left + PLOT.width * 0.75 ? -6 : 6),
        y: PAD.top + 11,
        'text-anchor': retirementX > PAD.left + PLOT.width * 0.75 ? 'end' : 'start',
      },
      `Aposentadoria aos ${plan.retirementAge}`,
    ),
  );

  chart.append(layer);
  attachHover(chart, points, { x, y, baseline, plan });
}

/**
 * Liga a leitura do gráfico ao ponteiro: destaca o ponto anual mais próximo e
 * mostra idade e saldo. A tabela ano a ano cobre o mesmo conteúdo para quem não
 * usa ponteiro.
 */
function attachHover(svg, points, { x, y, baseline }) {
  const hover = svgEl('g', { style: 'display:none; pointer-events:none' });
  const line = svgEl('line', { class: 'hover-line', y1: PAD.top, y2: baseline });
  const dot = svgEl('circle', { class: 'hover-dot', r: 4.5 });
  const box = svgEl('rect', { class: 'hover-box', rx: 6, width: 160, height: 44 });
  const ageText = svgEl('text', { class: 'hover-text-label' });
  const valueText = svgEl('text', { class: 'hover-text' });
  hover.append(line, box, ageText, valueText, dot);

  const surface = svgEl('rect', {
    x: PAD.left,
    y: PAD.top,
    width: PLOT.width,
    height: PLOT.height,
    fill: 'transparent',
  });

  const move = (event) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return;
    const viewX = ((event.clientX - bounds.left) / bounds.width) * VIEW.width;

    let nearest = points[0];
    for (const point of points) {
      if (Math.abs(x(point.age) - viewX) < Math.abs(x(nearest.age) - viewX)) nearest = point;
    }

    const pointX = x(nearest.age);
    const pointY = y(nearest.value);
    const isAccumulation = nearest.month <= 0 || pointY <= baseline;

    line.setAttribute('x1', pointX);
    line.setAttribute('x2', pointX);
    dot.setAttribute('cx', pointX);
    dot.setAttribute('cy', pointY);
    dot.setAttribute('stroke', 'currentColor');
    dot.style.color = isAccumulation ? 'var(--accent)' : 'var(--growth)';

    // Mantém a caixa dentro da área do gráfico.
    const boxX = Math.min(Math.max(pointX - 80, PAD.left), PAD.left + PLOT.width - 160);
    const boxY = Math.max(pointY - 56, PAD.top);
    box.setAttribute('x', boxX);
    box.setAttribute('y', boxY);
    ageText.setAttribute('x', boxX + 12);
    ageText.setAttribute('y', boxY + 17);
    valueText.setAttribute('x', boxX + 12);
    valueText.setAttribute('y', boxY + 34);
    ageText.textContent = `${Math.round(nearest.age)} anos`;
    valueText.textContent = currency.format(nearest.value);

    hover.style.display = '';
  };

  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerdown', move);
  surface.addEventListener('pointerleave', () => {
    hover.style.display = 'none';
  });

  svg.append(surface, hover);
}

/* ---------- Composição do patrimônio ---------- */

function renderBreakdown(result, plan) {
  const initial = Math.max(0, plan.initialBalance);
  const contributed = Math.max(0, result.totalContributed);
  const growth = Math.max(0, result.investmentGrowth);
  const total = initial + contributed + growth || 1;

  const share = (value) => `${(value / total) * 100}%`;
  document.getElementById('seg-initial').style.flexBasis = share(initial);
  document.getElementById('seg-contributed').style.flexBasis = share(contributed);
  document.getElementById('seg-growth').style.flexBasis = share(growth);

  text('value-initial', money(initial));
  text('value-contributed', money(contributed));
  text('value-growth', money(result.investmentGrowth));
}

/* ---------- Premissas ---------- */

function renderAssumptions(result, plan) {
  const rows = [
    ['Tempo até a aposentadoria', years(plan.retirementAge - plan.currentAge)],
    ['Duração da aposentadoria', years(plan.endAge - plan.retirementAge)],
    ['Retorno real na acumulação', percent.format(result.realAccumulationReturn)],
    ['Retorno real na aposentadoria', percent.format(result.realRetirementReturn)],
    ['Inflação considerada', percent.format(plan.inflation)],
    ['Aporte corrigido pela inflação', plan.indexContribution ? 'Sim' : 'Não'],
    ['Herança planejada', money(plan.legacy)],
    ['Saldo ao fim do período', money(result.legacyAtEnd)],
  ];

  const list = document.getElementById('assumptions');
  list.replaceChildren(
    ...rows.map(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = label;
      definition.textContent = value;
      wrapper.append(term, definition);
      return wrapper;
    }),
  );
}

/* ---------- Tabela ano a ano ---------- */

function renderTable(result, plan) {
  const lastMonth = result.balanceSeries.length - 1;
  const body = document.getElementById('table-body');
  const rows = [];

  for (let start = 0; start < lastMonth; start += 12) {
    const end = Math.min(start + 12, lastMonth);

    let flow = 0;
    for (let month = start + 1; month <= end; month++) flow += result.flowSeries[month];

    const opening = result.balanceSeries[start];
    const closing = result.balanceSeries[end];
    const growth = closing - opening - flow;
    const isRetirement = start >= result.accumulationMonths;

    const row = document.createElement('tr');
    row.dataset.phase = isRetirement ? 'retirement' : 'accumulation';

    const cells = [
      [String(plan.currentAge + end / 12), false],
      [isRetirement ? 'Aposentadoria' : 'Acumulação', false],
      [money(flow), flow < 0],
      [money(growth), growth < 0],
      [money(closing), false],
    ];

    for (const [value, negative] of cells) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (negative) cell.classList.add('negative');
      row.append(cell);
    }

    rows.push(row);
  }

  body.replaceChildren(...rows);
}

/* ---------- Veredito e cartões ---------- */

function renderVerdict(result, plan) {
  const verdict = document.getElementById('verdict');
  const surplus = result.projectedMonthlyIncome - result.desiredMonthlyIncome;

  if (result.neededFromPortfolio === 0) {
    verdict.dataset.status = 'good';
    text('verdict-title', 'Suas outras rendas já cobrem a meta');
    text(
      'verdict-detail',
      `${money(plan.otherMonthlyIncome)} por mês de INSS e outras fontes já atendem os ` +
        `${money(plan.desiredMonthlyIncome)} desejados. Tudo que você acumular vira folga.`,
    );
    return;
  }

  if (result.onTrack) {
    verdict.dataset.status = 'good';
    text('verdict-title', 'Seu plano chega lá');
    text(
      'verdict-detail',
      `Mantendo ${money(plan.monthlyContribution)} por mês, aos ${plan.retirementAge} anos você ` +
        `terá ${money(result.balanceAtRetirement)} e uma renda de ` +
        `${money(result.projectedMonthlyIncome)} por mês — ${money(Math.abs(surplus))} ` +
        `${surplus >= 0 ? 'acima' : 'abaixo'} da meta, com o dinheiro durando até os ${plan.endAge} anos.`,
    );
    return;
  }

  verdict.dataset.status = 'short';
  text('verdict-title', `Faltam ${money(result.gap)} de patrimônio`);

  const depletion =
    result.depletionAge === null
      ? ''
      : ` Mantendo a retirada desejada, o dinheiro acabaria aos ${Math.floor(result.depletionAge)} anos.`;

  const fix = Number.isFinite(result.requiredMonthlyContribution)
    ? `Aportar ${money(result.requiredMonthlyContribution)} por mês ` +
      `(${money(result.additionalMonthlyContribution)} a mais) fecha a conta.`
    : 'Com um retorno real nulo ou negativo, só aumentar o aporte não resolve: reveja as premissas.';

  text(
    'verdict-detail',
    `Sua renda projetada é ${money(result.projectedMonthlyIncome)} por mês, contra ` +
      `${money(plan.desiredMonthlyIncome)} desejados. ${fix}${depletion}`,
  );
}

function renderCards(result, plan) {
  const incomeCard = document.getElementById('card-income');
  incomeCard.dataset.tone = result.onTrack ? 'good' : 'short';
  text('value-income', money(result.projectedMonthlyIncome));
  text(
    'note-income',
    `Meta: ${money(plan.desiredMonthlyIncome)} · carteira ${money(result.sustainableIncome)} + ` +
      `outras rendas ${money(plan.otherMonthlyIncome)}`,
  );

  text('value-balance', money(result.balanceAtRetirement));
  text('note-balance', `Em ${years(plan.retirementAge - plan.currentAge)}, em valores de hoje`);

  text('value-target', money(result.targetBalance));
  text(
    'note-target',
    result.onTrack
      ? `Sobra de ${money(-result.gap)}`
      : `Faltam ${money(result.gap)}`,
  );

  const contributionCard = document.getElementById('card-contribution');
  contributionCard.dataset.tone = result.onTrack ? 'good' : 'short';
  text('value-contribution', money(result.requiredMonthlyContribution));
  text(
    'note-contribution',
    result.onTrack
      ? `Você já aporta ${money(plan.monthlyContribution)}`
      : `${money(result.additionalMonthlyContribution)} a mais do que hoje`,
  );
}

/* ---------- Orquestração ---------- */

function render() {
  const plan = readPlan();
  const errors = validate(plan);

  if (errors.length > 0) {
    errorList.replaceChildren(
      ...errors.map((message) => {
        const item = document.createElement('li');
        item.textContent = message;
        return item;
      }),
    );
    errorBox.hidden = false;
    results.style.opacity = '0.4';
    return;
  }

  errorBox.hidden = true;
  results.style.opacity = '1';

  const result = project(plan);

  renderVerdict(result, plan);
  renderCards(result, plan);
  renderChart(result, plan);
  renderBreakdown(result, plan);
  renderAssumptions(result, plan);
  renderTable(result, plan);

  text(
    'chart-note',
    result.depletionAge === null
      ? `O patrimônio sustenta ${money(result.sustainableIncome)} por mês até os ${plan.endAge} anos.`
      : `Retirando os ${money(result.neededFromPortfolio)} mensais desejados da carteira, o saldo ` +
        `zeraria aos ${Math.floor(result.depletionAge)} anos.`,
  );
}

form.addEventListener('input', render);
// O formulário só volta aos valores padrão depois do evento `reset`.
form.addEventListener('reset', () => window.setTimeout(render, 0));
// O gráfico usa medidas em pixels do ponteiro; redesenhar mantém o hover correto.
window.addEventListener('resize', render);

render();
