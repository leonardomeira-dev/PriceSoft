/**
 * Gráficos em SVG puro, sem biblioteca.
 *
 * Cada função recebe o `<svg>` de destino e os dados já calculados, e devolve o
 * desenho pronto. As cores vêm de variáveis CSS por papel (`--series-*`), então
 * um mesmo gráfico responde ao tema claro e ao escuro sem código condicional.
 *
 * A paleta categórica foi validada com o verificador de contraste e de visão de
 * cores: azul, aqua e laranja são os únicos três que passam em todos os pares
 * nos dois temas. Nenhuma informação depende só da cor — toda série tem rótulo
 * direto ou legenda, e a tabela ano a ano repete os mesmos números.
 */

import { money, moneyShort, moneySigned, pctShort } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

/** Cria um elemento SVG com atributos e, opcionalmente, texto. */
export function node(name, attributes = {}, textContent) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

/** O usuário pediu para reduzir animações? */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Arredonda para cima até um número redondo (1, 2, 2,5 ou 5 vezes uma potência
 * de dez), para o eixo ter marcações legíveis.
 */
export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/* ============================================================
   1. Patrimônio ao longo da vida — área empilhada no tempo
   ============================================================ */

const WEALTH = {
  view: { width: 880, height: 320 },
  pad: { top: 18, right: 20, bottom: 34, left: 92 },
};
WEALTH.plot = {
  width: WEALTH.view.width - WEALTH.pad.left - WEALTH.pad.right,
  height: WEALTH.view.height - WEALTH.pad.top - WEALTH.pad.bottom,
};

const ageStep = (span) => [5, 10, 15, 20, 25].find((candidate) => span / candidate <= 7) ?? 30;

/**
 * Desenha a evolução do patrimônio: o bem produtivo por baixo e a carteira
 * empilhada por cima, de modo que o topo da pilha é o patrimônio total.
 *
 * A carteira é uma entidade só, então usa um único tom em todo o gráfico; a
 * mudança de fase aparece pelo traço tracejado no usufruto, pela régua vertical
 * e pelo rótulo — nunca por uma segunda cor, que seria lida como outra série.
 *
 * @param {SVGElement} svg destino
 * @param {object} result resultado de `project`
 * @param {object} plan plano do usuário
 * @param {{animate?: boolean, title?: SVGElement}} options
 */
export function drawWealthChart(svg, result, plan, { animate = false, title } = {}) {
  const { pad, plot, view } = WEALTH;
  svg.replaceChildren(...(title ? [title] : []));

  const lastMonth = result.balanceSeries.length - 1;
  const sampled = new Set([result.accumulationMonths, lastMonth]);
  for (let month = 0; month <= lastMonth; month += 12) sampled.add(month);

  const points = [...sampled]
    .sort((a, b) => a - b)
    .map((month) => ({
      month,
      age: plan.currentAge + month / 12,
      portfolio: result.balanceSeries[month],
      productive: result.productiveSeries[month],
      total: result.balanceSeries[month] + result.productiveSeries[month],
    }));

  const maxValue = niceCeil(Math.max(...points.map((point) => point.total), 1));
  const span = Math.max(plan.endAge - plan.currentAge, 1);
  const x = (age) => pad.left + ((age - plan.currentAge) / span) * plot.width;
  const y = (value) => pad.top + plot.height - (value / maxValue) * plot.height;
  const baseline = pad.top + plot.height;

  const axes = node('g');

  for (let index = 0; index <= 4; index++) {
    const value = (maxValue / 4) * index;
    const lineY = y(value);
    axes.append(
      node('line', {
        class: index === 0 ? 'axis' : 'grid',
        x1: pad.left, x2: pad.left + plot.width, y1: lineY, y2: lineY,
      }),
      node('text', { class: 'tick', x: pad.left - 10, y: lineY + 4, 'text-anchor': 'end' },
        index === 0 ? '0' : moneyShort(value)),
    );
  }

  // A idade final é sempre marcada; a marcação regular vizinha sai se colidir.
  const step = ageStep(span);
  const ticks = [];
  for (let age = plan.currentAge; age < plan.endAge; age += step) ticks.push(age);
  if (ticks.length > 1 && plan.endAge - ticks[ticks.length - 1] < step * 0.6) ticks.pop();
  ticks.push(plan.endAge);

  ticks.forEach((age, index) => {
    const last = index === ticks.length - 1;
    axes.append(node('text', {
      class: 'tick', x: x(age), y: baseline + 20, 'text-anchor': last ? 'end' : 'middle',
    }, last ? `${Math.round(age)} anos` : String(Math.round(age))));
  });
  svg.append(axes);

  // As faixas entram sob um clip que se abre da esquerda para a direita.
  const clipId = `wealth-reveal-${Math.random().toString(36).slice(2, 8)}`;
  const clip = node('clipPath', { id: clipId });
  const revealRect = node('rect', {
    class: 'reveal', x: pad.left, y: pad.top - 4, width: plot.width, height: plot.height + 8,
  });
  clip.append(revealRect);
  const defs = node('defs');
  defs.append(clip);
  svg.append(defs);

  const marks = node('g', { 'clip-path': `url(#${clipId})` });

  const hasProductive = points.some((point) => point.productive > 0);
  if (hasProductive) {
    const band = points.map((point) => `${x(point.age)},${y(point.productive)}`).join(' L ');
    marks.append(
      node('path', {
        class: 'fill-productive',
        d: `M ${x(points[0].age)},${baseline} L ${band} L ${x(points[points.length - 1].age)},${baseline} Z`,
      }),
      node('path', { class: 'line-productive', d: `M ${band}` }),
    );
  }

  // A carteira é uma faixa entre o topo do bem produtivo e o patrimônio total.
  const drawPhase = (list, phase) => {
    if (list.length < 2) return;
    const top = list.map((point) => `${x(point.age)},${y(point.total)}`).join(' L ');
    const floor = [...list].reverse().map((point) => `${x(point.age)},${y(point.productive)}`).join(' L ');
    marks.append(
      node('path', { class: `fill-portfolio fill-portfolio--${phase}`, d: `M ${top} L ${floor} Z` }),
      node('path', { class: `line-portfolio line-portfolio--${phase}`, d: `M ${top}` }),
    );
  };

  drawPhase(points.filter((point) => point.month <= result.accumulationMonths), 'accumulation');
  drawPhase(points.filter((point) => point.month >= result.accumulationMonths), 'retirement');
  svg.append(marks);

  const retirementX = x(plan.retirementAge);
  const nearRight = retirementX > pad.left + plot.width * 0.72;
  svg.append(
    node('line', { class: 'rule', x1: retirementX, x2: retirementX, y1: pad.top, y2: baseline }),
    node('circle', {
      class: 'peak', cx: retirementX, r: 4,
      cy: y(result.balanceAtRetirement + result.productiveSeries[result.accumulationMonths]),
    }),
    node('text', {
      class: 'rule-label',
      x: retirementX + (nearRight ? -8 : 8),
      y: pad.top + 11,
      'text-anchor': nearRight ? 'end' : 'start',
    }, `Aposentadoria aos ${plan.retirementAge}`),
  );

  attachCrosshair(svg, points, { x, y, baseline, view, pad, plot, accumulationMonths: result.accumulationMonths });

  if (animate && !prefersReducedMotion()) revealRect.classList.add('reveal--animate');

  return { hasProductive };
}

/** Cruz e tooltip seguindo o ponteiro sobre a área. */
function attachCrosshair(svg, points, { x, y, baseline, view, pad, plot, accumulationMonths }) {
  const group = node('g', { class: 'crosshair', style: 'display:none; pointer-events:none' });
  const rule = node('line', { class: 'probe', y1: pad.top, y2: baseline });
  const dot = node('circle', { class: 'probe-dot', r: 4.5 });
  const box = node('rect', { class: 'probe-box', rx: 6, width: 162, height: 46 });
  const ageLabel = node('text', { class: 'probe-age' });
  const valueLabel = node('text', { class: 'probe-value' });
  group.append(rule, box, ageLabel, valueLabel, dot);

  const surface = node('rect', {
    x: pad.left, y: pad.top, width: plot.width, height: plot.height, fill: 'transparent',
  });

  const move = (event) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0) return;
    const viewX = ((event.clientX - bounds.left) / bounds.width) * view.width;

    let nearest = points[0];
    for (const point of points) {
      if (Math.abs(x(point.age) - viewX) < Math.abs(x(nearest.age) - viewX)) nearest = point;
    }

    const pointX = x(nearest.age);
    const pointY = y(nearest.total);
    rule.setAttribute('x1', pointX);
    rule.setAttribute('x2', pointX);
    dot.setAttribute('cx', pointX);
    dot.setAttribute('cy', pointY);
    dot.classList.toggle('probe-dot--retired', nearest.month > accumulationMonths);

    const boxX = Math.min(Math.max(pointX - 81, pad.left), pad.left + plot.width - 162);
    const boxY = Math.max(pointY - 58, pad.top);
    box.setAttribute('x', boxX);
    box.setAttribute('y', boxY);
    ageLabel.setAttribute('x', boxX + 13);
    ageLabel.setAttribute('y', boxY + 18);
    valueLabel.setAttribute('x', boxX + 13);
    valueLabel.setAttribute('y', boxY + 35);
    ageLabel.textContent = `${Math.round(nearest.age)} anos`;
    valueLabel.textContent = money(nearest.total);
    group.style.display = '';
  };

  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerdown', move);
  surface.addEventListener('pointerleave', () => { group.style.display = 'none'; });
  svg.append(surface, group);
}

/* ============================================================
   2. Sensibilidade — barras divergentes ordenadas por impacto
   ============================================================ */

/**
 * Desenha o quanto cada alavanca move a renda mensal.
 *
 * Barras divergem de um zero central: à direita o que melhora, à esquerda o que
 * piora. Cada barra carrega o valor com sinal como rótulo direto, então a
 * polaridade nunca depende só da cor.
 *
 * @param {HTMLElement} host container
 * @param {{levers: Array<{label: string, delta: number}>}} data
 */
export function drawSensitivity(host, { levers }) {
  const largest = Math.max(...levers.map((lever) => Math.abs(lever.delta)), 1);

  host.replaceChildren(...levers.map((lever) => {
    const row = document.createElement('div');
    row.className = 'lever';
    row.dataset.sign = lever.delta >= 0 ? 'positive' : 'negative';

    const label = document.createElement('span');
    label.className = 'lever-label';
    label.textContent = lever.label;

    const track = document.createElement('span');
    track.className = 'lever-track';
    const bar = document.createElement('span');
    bar.className = 'lever-bar';
    // A barra parte do centro; a largura é a fração do maior impacto.
    bar.style.width = `${(Math.abs(lever.delta) / largest) * 50}%`;
    track.append(bar);

    const value = document.createElement('span');
    value.className = 'lever-value';
    value.textContent = moneySigned(lever.delta);

    row.append(label, track, value);
    return row;
  }));
}

/* ============================================================
   3. Composição da renda — uma barra empilhada
   ============================================================ */

/**
 * De onde vem cada real da renda mensal. Três categorias, rotuladas
 * diretamente — parte de um todo, então uma barra empilhada, não uma pizza.
 *
 * @param {HTMLElement} bar barra empilhada
 * @param {HTMLElement} legend lista de rótulos
 * @param {{total: number, sources: Array<{id: string, label: string, value: number}>}} data
 */
export function drawIncomeMix(bar, legend, { total, sources }) {
  const safeTotal = total || 1;

  bar.replaceChildren(...sources.map((source) => {
    const segment = document.createElement('span');
    segment.className = `mix-segment mix-segment--${source.id}`;
    segment.style.flexBasis = `${(source.value / safeTotal) * 100}%`;
    return segment;
  }));

  legend.replaceChildren(...sources.map((source) => {
    const item = document.createElement('div');
    item.className = 'mix-item';

    const term = document.createElement('dt');
    term.dataset.source = source.id;
    term.textContent = source.label;

    const definition = document.createElement('dd');
    definition.textContent = `${money(source.value)} · ${pctShort(source.value / safeTotal)}`;

    item.append(term, definition);
    return item;
  }));
}

/* ============================================================
   4. Queda de mercado — barras contra a linha da meta
   ============================================================ */

/**
 * Renda resultante se o mercado cair logo no ano da aposentadoria.
 *
 * A meta aparece como uma régua vertical, então dá para ver de relance qual
 * queda ainda mantém o plano de pé.
 *
 * @param {HTMLElement} host container
 * @param {Array<{drop: number, income: number, coverage: number}>} scenarios
 * @param {number} goal renda mensal desejada
 */
export function drawCrashScenarios(host, scenarios, goal) {
  const largest = Math.max(...scenarios.map((scenario) => scenario.income), goal, 1);

  host.replaceChildren(...scenarios.map((scenario) => {
    const row = document.createElement('div');
    row.className = 'crash';
    row.dataset.covered = scenario.coverage >= 1 ? 'yes' : 'no';

    const label = document.createElement('span');
    label.className = 'crash-label';
    label.textContent = `Queda de ${Math.round(scenario.drop * 100)}%`;

    const track = document.createElement('span');
    track.className = 'crash-track';

    const bar = document.createElement('span');
    bar.className = 'crash-bar';
    bar.style.width = `${(scenario.income / largest) * 100}%`;

    const goalMark = document.createElement('span');
    goalMark.className = 'crash-goal';
    goalMark.style.left = `${(goal / largest) * 100}%`;
    goalMark.title = `Meta: ${money(goal)}`;

    track.append(bar, goalMark);

    const value = document.createElement('span');
    value.className = 'crash-value';
    value.textContent = money(scenario.income);

    row.append(label, track, value);
    return row;
  }));
}
