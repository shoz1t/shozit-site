// Плоская версия логотипа Rigged (без глянцевых градиентов) с износом из масок.
// Контуры взяты из assets/rigged/media/rigged-logo.svg. Запуск: node tools/make-rigged-logo.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wearMask } from './logo-glyphs.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'img', 'rigged-logo.svg');
const CREAM = '#e8dcc0', AMBER = '#d9ad67';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 230" width="1000" height="230" role="img" aria-label="Rigged">
<title>Rigged</title>
<defs>${wearMask('w', [20, 20, 960, 170], { specks: 520, scratches: 5, seed: 41 })}</defs>
<g mask="url(#w)">
<g fill="${CREAM}" fill-rule="evenodd">
<path d="M30 185V117L68 112V107L30 112V25H142L166 49V101L145 122H68V185ZM68 59V89H128V59Z"/>
<path fill="${AMBER}" d="M99 129H140L178 185H132Z"/>
<path d="M202 25H263V104L202 112ZM202 117L263 109V185H202Z"/>
<path d="M311 25H429L453 49V77H413V59H329V151H413V129H377V97H453V161L429 185H311L287 161V49Z"/>
<path d="M504 25H622L646 49V77H606V59H522V151H606V129H570V97H646V161L622 185H504L480 161V49Z"/>
<path d="M674 25H801V59H714V88H785V122H714V151H801V185H674V138L714 133V128L674 133Z"/>
<path d="M829 25H943L970 52V158L943 185H829ZM869 59V151H930V59Z"/>
</g>
<g fill="${AMBER}"><path d="M30 202H87L81 208H30Z"/><path d="M919 202H970V208H913Z"/></g>
</g>
</svg>`;
writeFileSync(OUT, svg);
console.log('rigged-logo.svg', svg.length, 'B');
