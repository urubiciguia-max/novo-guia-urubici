/**
 * Mesmos defaults que `admin-app/web/src/lib/env.ts` já usa
 * (`GH_OWNER`/`GH_REPO`) -- repetidos aqui (não importados de lá, ver nota
 * em `slug.ts` sobre as Functions serem um pacote separado). Sem variável
 * de ambiente nova: só existiria motivo pra isso se este repo um dia
 * precisasse apontar pra outro owner/repo, o que não é o caso hoje.
 */
export const GITHUB_OWNER = 'urubiciguia-max';
export const GITHUB_REPO = 'novo-guia-urubici';
