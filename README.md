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
fechadas de valor futuro e de anuidade, esgotamento do saldo, herança, patrimônio produtivo e
renda passiva (reinvestida, consumida e com venda do bem), além dos casos de contorno de taxa
real nula ou negativa.

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

## Patrimônio produtivo e renda passiva

Carteira financeira e patrimônio produtivo são coisas diferentes, e o cálculo trata cada uma
como tal:

- A **carteira** acumula e depois é **consumida** — é ela que zera no fim do plano.
- O **patrimônio produtivo** (imóvel alugado, participação em negócio) **não é consumido**: ele
  continua rendendo e sobra como herança.

Disso vêm três efeitos que mudam bastante o resultado:

1. **A renda passiva já existe hoje.** Se for reinvestida, entra na acumulação como um segundo
   fluxo mensal, ao lado do aporte.
2. **Ela continua na aposentadoria.** Some da renda desejada junto com o INSS, então a carteira
   precisa cobrir só a diferença — e o patrimônio necessário cai na mesma proporção.
3. **Vender o bem troca renda por saldo.** O valor de mercado vira carteira consumível e a renda
   passiva acaba; a calculadora mostra os dois cenários lado a lado.

A renda passiva acompanha o valor do bem que a gera — o rendimento percentual fica constante,
então ambos crescem à mesma taxa real. A valorização é informada **já em termos reais** (acima da
inflação), então não passa por Fisher; zero significa apenas manter o poder de compra. Durante a
aposentadoria a renda passiva é tratada como constante em termos reais, premissa conservadora.

O segundo fluxo entra no termo constante da acumulação, nunca no marginal, então o aporte
necessário continua saindo por solução exata.

## Análises

Além da projeção, a calculadora responde as perguntas que vêm depois:

- **O que mais move o seu plano** — mede, uma mudança de cada vez, quanto cada alavanca desloca a
  renda mensal, e ordena por impacto. Costuma surpreender: adiar a aposentadoria quase sempre pesa
  mais que aumentar o aporte.
- **Quando você poderia parar** — a idade mais cedo que ainda fecha a meta com o aporte atual.
  Adiar melhora por dois caminhos ao mesmo tempo (mais meses acumulando, menos meses a sustentar),
  então a viabilidade é monótona na idade e uma busca binária basta.
- **Se o mercado cair na hora errada** — risco de sequência de retornos: a mesma rentabilidade
  média machuca muito mais quando a queda chega logo no começo do usufruto, porque o saque passa a
  incidir sobre um patrimônio já reduzido.
- **Taxa de retirada** — quanto do patrimônio sai no primeiro ano, comparado à referência de 4%.

## Gráficos

Sem biblioteca: SVG e CSS puros, desenhados a partir das cores por papel, então um mesmo gráfico
responde ao tema claro e ao escuro sem código condicional.

A paleta categórica foi verificada com um validador de contraste e de visão de cores — azul, aqua
e laranja são o único trio que passa em **todos** os pares nos dois temas. Nenhuma informação
depende só da cor: toda série tem rótulo direto ou legenda, as barras divergentes trazem o valor
com sinal, e a tabela ano a ano repete os mesmos números.

No gráfico de patrimônio a carteira é uma entidade só e usa um único tom do começo ao fim; a fase
de usufruto se distingue pelo traço tracejado, pela régua vertical e pelo rótulo — nunca por uma
segunda cor, que seria lida como outra série.

As animações são discretas e todas passam por `prefers-reduced-motion`: a área do gráfico se abre
da esquerda para a direita, os números transitam até o novo valor, e as barras acompanham.

## Estrutura

```
index.html               página única
assets/styles.css        estilos, com tema claro e escuro
src/retirement.js        motor de cálculo — puro, sem DOM
src/analysis.js          análises derivadas — sensibilidade, risco, taxa de retirada
src/charts.js            gráficos em SVG e CSS
src/format.js            formatação em pt-BR
src/app.js               leitura do formulário e orquestração
scripts/serve.js         servidor estático de desenvolvimento
scripts/build-artifact.js gera a versão de arquivo único
test/                    testes do motor e das análises
```

A separação importa: `retirement.js` e `analysis.js` não conhecem DOM nem formatação, e `app.js`
não contém nenhuma regra financeira.

## Versão de arquivo único

```bash
npm run build      # gera dist/aposentadoria.html
```

A página publicada e o repositório eram mantidos à mão em paralelo, e cada mudança precisava ser
portada duas vezes — um convite a divergirem. Agora a fonte é sempre `index.html` e os módulos que
ele carrega; o arquivo único é derivado.

## Premissas e limites

As projeções assumem rentabilidade e inflação constantes ao longo de décadas — útil para
comparar cenários, não para prever o futuro. Não são considerados imposto de renda, taxas de
administração, come-cotas, nem mudanças de regra da previdência. É uma ferramenta educativa de
planejamento e não constitui recomendação de investimento.
