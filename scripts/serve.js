/**
 * Servidor estático mínimo para desenvolvimento.
 *
 * Os módulos ES do projeto são carregados por `import`, o que o navegador
 * bloqueia sob o protocolo `file://`. Este servidor existe só para abrir a
 * página em `http://localhost` sem trazer nenhuma dependência para o projeto.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Resolve o caminho pedido dentro da raiz do projeto.
 * @param {string} url URL da requisição
 * @returns {string|null} caminho absoluto, ou `null` se escapar da raiz
 */
function resolvePath(url) {
  const { pathname } = new URL(url, 'http://localhost');
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^(\.\.[/\\])+/, '');
  const target = join(ROOT, relative);
  // Impede que `..` no caminho sirva arquivos de fora do projeto.
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

const server = createServer(async (request, response) => {
  const target = request.url ? resolvePath(request.url) : null;

  if (target === null) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('403 — caminho fora do projeto');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('não é um arquivo');

    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('404 — não encontrado');
  }
});

server.listen(PORT, () => {
  console.log(`Calculadora de aposentadoria em http://localhost:${PORT}`);
});
