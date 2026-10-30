#!/usr/bin/env node
/**
 * Detector de "drift" do build do admin CMS custom (public/admin/).
 *
 * Por que isso existe em vez de só rebuildar e comparar `public/admin/`
 * byte a byte: o build da SPA (Vite/esbuild) **não é reprodutível
 * byte-a-byte entre ambientes diferentes** -- confirmado empiricamente
 * (Tião, 2026-10-30): dois builds do MESMO código-fonte, com as MESMAS
 * versões travadas em `package-lock.json`, geraram `public/admin/assets/
 * index-*.js` com hash de conteúdo diferente (nomes de variável minificados
 * saem em ordem diferente -- característica conhecida do minificador do
 * esbuild, que não garante determinismo entre ambientes/plataformas, só
 * dentro do mesmo processo/ambiente). Um check de CI que falhasse em
 * qualquer diff byte-a-byte em `public/admin/` daria falso positivo
 * sempre, mesmo sem nenhuma mudança real de código -- inútil (equipe
 * aprenderia a ignorar o CI).
 *
 * Em vez disso, este script faz fingerprint do CÓDIGO-FONTE (não do
 * output do build) e grava/compara um hash único em `.admin-build-hash`
 * na raiz do projeto:
 *
 *   node scripts/admin-build-hash.mjs --write   # roda dentro de `npm run build:admin`, grava o hash atual
 *   node scripts/admin-build-hash.mjs --check   # roda no CI, falha (exit 1) se o hash do source atual
 *                                                # não bate com o que está gravado em `.admin-build-hash`
 *
 * Se o hash não bate, significa: alguém mudou `admin-app/src` ou
 * `admin-app/web/src` (ou os manifestos de dependência) sem rodar
 * `npm run build:admin` e commitar o resultado -- a causa raiz do drift
 * que essa automação existe pra pegar.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const hashFile = join(repoRoot, '.admin-build-hash');

// Tudo que influencia o output gerado em public/admin/. Mudar qualquer
// coisa aqui sem rebuildar é exatamente o "drift" que queremos pegar.
const SOURCES = [
  'admin-app/src',
  'admin-app/package.json',
  'admin-app/package-lock.json',
  'admin-app/web/src',
  'admin-app/web/index.html',
  'admin-app/web/package.json',
  'admin-app/web/package-lock.json',
  'admin-app/web/vite.config.ts',
  'admin-app/web/tsconfig.json',
];

function listFiles(absPath) {
  const st = statSync(absPath);
  if (st.isFile()) return [absPath];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(absPath)) {
    out.push(...listFiles(join(absPath, entry)));
  }
  return out;
}

function computeHash() {
  const hash = createHash('sha256');
  const files = [];
  for (const rel of SOURCES) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    files.push(...listFiles(abs));
  }
  files.sort();
  for (const abs of files) {
    const relPath = relative(repoRoot, abs).split(sep).join('/');
    hash.update('\0path:' + relPath + '\0');
    hash.update(readFileSync(abs));
  }
  return hash.digest('hex');
}

const mode = process.argv[2];
const currentHash = computeHash();

if (mode === '--write') {
  writeFileSync(
    hashFile,
    `${currentHash}\n`,
  );
  console.log(`[admin-build-hash] gravado em .admin-build-hash: ${currentHash}`);
  process.exit(0);
}

if (mode === '--check') {
  if (!existsSync(hashFile)) {
    console.error('[admin-build-hash] .admin-build-hash não existe. Rode "npm run build:admin" e comite o resultado.');
    process.exit(1);
  }
  const recorded = readFileSync(hashFile, 'utf8').trim();
  if (recorded !== currentHash) {
    console.error('[admin-build-hash] DRIFT DETECTADO: o código-fonte do admin (admin-app/src ou admin-app/web/src/deps) mudou desde o último "npm run build:admin".');
    console.error(`[admin-build-hash] hash gravado:  ${recorded}`);
    console.error(`[admin-build-hash] hash atual:     ${currentHash}`);
    console.error('[admin-build-hash] Rode "npm run build:admin" na raiz, revise o diff de public/admin/ e comite tudo junto (código + public/admin/ + .admin-build-hash).');
    process.exit(1);
  }
  console.log('[admin-build-hash] OK, sem drift -- .admin-build-hash bate com o código-fonte atual.');
  process.exit(0);
}

console.error('Uso: node scripts/admin-build-hash.mjs --write | --check');
process.exit(1);
