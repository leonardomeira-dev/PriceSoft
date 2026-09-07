/**
 * Gera a versão de arquivo único da calculadora a partir das fontes do projeto.
 *
 * A página publicada e o repositório eram mantidos à mão em paralelo, e cada
 * mudança precisava ser portada duas vezes — um convite a divergirem. Aqui a
 * fonte é sempre `index.html` e os módulos que ele carrega; o arquivo publicado
 * é derivado.
 *
 * O formato de saída é o esperado pelo serviço de artifacts: sem `<!doctype>`,
 * `<html>`, `<head>` ou `<body>` (ele envolve o conteúdo), com o `<title>`, os
 * links de fonte e o CSS embutidos no topo, e os módulos concatenados num único
 * script clássico.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT = resolve(ROOT, 'dist/aposentadoria.html');

/**
 * Ordem de concatenação dos módulos. Como as declarações `import`/`export` são
 * removidas, a ordem precisa respeitar as dependências: quem é importado vem
 * antes de quem importa.
 */
const MODULES = ['src/format.js', 'src/retirement.js', 'src/analysis.js', 'src/charts.js', 'src/app.js'];

const read = (relative) => readFile(resolve(ROOT, relative), 'utf8');

/**
 * Remove as declarações de módulo, mantendo o corpo intacto.
 *
 * Os módulos viram um escopo único, então `import` some e `export` vira apenas a
 * declaração que ele exportava.
 *
 * @param {string} source código do módulo
 * @returns {string} código sem sintaxe de módulo
 */
function stripModuleSyntax(source) {
  return source
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(?=(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};\s*$/gm, '')
    .trimEnd();
}

/**
 * Extrai o conteúdo de uma tag do HTML de origem.
 * @param {string} html documento
 * @param {string} tag nome da tag
 * @returns {string} conteúdo interno
 */
function inner(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (match === null) throw new Error(`Não achei <${tag}> em index.html`);
  return match[1];
}

const html = await read('index.html');
const css = await read('assets/styles.css');

const title = inner(html, 'title').replace(' — PriceSoft', '').trim();

// Os <link> de fonte são preservados: são a única origem externa que a política
// de conteúdo do artifact admite para folhas de estilo.
const fontLinks = [...html.matchAll(/<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)]
  .map((match) => match[0].trim())
  .join('\n');

// O corpo, sem o <script type="module"> que só existe na versão servida por HTTP.
const body = inner(html, 'body')
  .replace(/<script\b[^>]*type="module"[^>]*><\/script>/g, '')
  .trim();

const scripts = [];
for (const path of MODULES) scripts.push(`/* ===== ${path} ===== */\n${stripModuleSyntax(await read(path))}`);

const output = `<title>${title}</title>
${fontLinks}

<style>
${css.trim()}
</style>

${body}

<script>
  (() => {
    'use strict';

${scripts.join('\n\n')}
  })();
</script>
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output, 'utf8');
console.log(`Artifact gerado: ${OUTPUT} (${(output.length / 1024).toFixed(1)} KB)`);
