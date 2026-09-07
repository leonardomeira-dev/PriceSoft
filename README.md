# Calculadora de Aposentadoria

Ferramenta web que projeta a aposentadoria em **valores de hoje**: quanto você terá acumulado,
que renda mensal esse patrimônio sustenta e quanto precisa aportar para alcançar a renda desejada.

Sem dependências, sem etapa de build — HTML, CSS e módulos ES puros.

## Como rodar

```bash
npm start          # http://localhost:8080
```

O `npm start` sobe um servidor estático mínimo (`scripts/serve.js`). Ele é necessário porque a
página carrega módulos ES por `import`, o que os navegadores bloqueiam sob `file://`. Qualquer
outro servidor estático serve igualmente bem:

```bash
python3 -m http.server 8080
```

## Testes

```bash
npm test           # node:test, sem dependências
```

Os testes cobrem o motor de cálculo (`src/retirement.js`): equivalência de taxas, fórmulas
fechadas de valor futuro e de anuidade, esgotamento do saldo, herança e os casos de contorno
de taxa real nula ou negativa.

## Como o cálculo funciona

Todos os valores exibidos estão em **poder de compra de hoje**. Em vez de inflacionar os saldos
e depois pedir que o usuário desconte a inflação de cabeça, a projeção trabalha com taxas reais:

- **Taxa real** pela equação de Fisher: `(1 + nominal) / (1 + inflação) - 1`.
- **Taxa mensal** por equivalência composta: `(1 + anual)^(1/12) - 1` — não por divisão por 12.
- **Aportes e retiradas no fim do mês** (anuidade postecipada), de modo que cada mês é
  `saldo × (1 + i) + aporte - retirada`.

A partir daí:

| Resultado | Como sai |
| --- | --- |
| Patrimônio na aposentadoria | Simulação mês a mês da acumulação |
| Renda mensal sustentável | Saldo dividido pelo fator de anuidade, descontada a herança desejada |
| Patrimônio necessário | Valor presente da renda desejada mais o valor presente da herança |
| Aporte mensal necessário | O saldo acumulado é função afim do aporte, então basta o saldo sem aporte e o ganho de um aporte unitário — solução exata, sem iteração |
| Idade de esgotamento | Simulação da retirada desejada até o saldo zerar |

Se o aporte não for corrigido pela inflação, ele perde poder de compra a cada mês; a simulação
representa isso encolhendo o aporte em termos reais, e o patrimônio final cai.

## Estrutura

```
index.html            página única
assets/styles.css     estilos, com tema claro e escuro
src/retirement.js     motor de cálculo — puro, sem DOM, é o que os testes exercitam
src/app.js            leitura do formulário, gráfico SVG, tabela e cartões
scripts/serve.js      servidor estático de desenvolvimento
test/                 testes do motor de cálculo
```

A separação importa: `src/retirement.js` não conhece DOM nem formatação, e `src/app.js` não
contém nenhuma regra financeira.

## Premissas e limites

As projeções assumem rentabilidade e inflação constantes ao longo de décadas — útil para
comparar cenários, não para prever o futuro. Não são considerados imposto de renda, taxas de
administração, come-cotas, nem mudanças de regra da previdência. É uma ferramenta educativa de
planejamento e não constitui recomendação de investimento.
