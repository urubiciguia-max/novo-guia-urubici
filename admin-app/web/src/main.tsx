import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Fontes auto-hospedadas (@fontsource, mesmo pacote do site principal) --
// só os 2 pesos que o CSS do admin de fato usa (confirmado via grep
// `font-weight` em index.css): Poppins 700 (headings/display, sempre bold
// aqui -- h1-h3 herdam bold do UA stylesheet) e Inter 400/600 (corpo e
// ênfases/botões). Importa os arquivos de SUBSET `latin`/`latin-ext` (não
// o `400.css`/`700.css` genérico, que embute cirílico/grego/vietnamita/
// devanágari que um painel em português nunca usa) -- latin + latin-ext
// cobrem toda a acentuação do PT-BR (ç, ã, õ, á, é...). Decisão do
// Leonardo (fase de polish) -- identidade tipográfica alinhada ao site
// público em vez do fallback system-ui que o Francisgleydisson deixou, com
// o mínimo de peso extra possível.
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-ext-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Elemento #root não encontrado em index.html.');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
