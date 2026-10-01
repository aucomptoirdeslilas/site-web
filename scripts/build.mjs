// Construit la version publiée du site dans _site/ (lancé par GitHub Actions à chaque push sur main).
//
// index.html (racine) reste l'unique source à modifier : il fonctionne tel quel en l'ouvrant dans un navigateur
// (le code React y est converti à la volée par Babel). Pour la mise en ligne, ce script :
//   1. convertit le code React (<script type="text/babel">) en JavaScript classique et le minifie,
//   2. supprime le chargement de Babel (≈ 3 Mo que chaque visiteur n'a plus à télécharger),
//   3. sert React depuis le site lui-même (vendor/) au lieu de unpkg.com,
//   4. copie le reste du site (images, vidéos, pages…) tel quel.
// Si une étape échoue, le script s'arrête en erreur et la version en ligne actuelle reste en place.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import { minify } from 'terser';

const require = createRequire(import.meta.url);
const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = join(racine, '_site');

// Fichiers et dossiers du dépôt qui ne sont pas publiés
const EXCLUS = new Set([
  '.git', '.github', '.gitignore', 'node_modules', '_site', 'scripts',
  'package.json', 'package-lock.json',
  'nouveau-site', // ancienne copie de travail, plus utilisée
]);

function remplacer(html, motif, par, description) {
  if (!motif.test(html)) throw new Error(`Build interrompu : ${description} introuvable dans index.html`);
  return html.replace(motif, par);
}

let html = readFileSync(join(racine, 'index.html'), 'utf8');

// 1. Code React → JavaScript classique, minifié
const blocBabel = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const jsx = html.match(blocBabel)?.[1];
if (!jsx) throw new Error('Build interrompu : bloc <script type="text/babel"> introuvable dans index.html');
const { code } = transformSync(jsx, { presets: ['@babel/preset-react'], babelrc: false, configFile: false, filename: 'app.jsx' });
const { code: codeMin } = await minify(code, { compress: true, mangle: true });
html = html.replace(blocBabel, () => `<script>${codeMin.replace(/<\/script/gi, '<\\/script')}</script>`);

// 2. Plus besoin de Babel dans le navigateur
html = remplacer(html, /\s*<script src="[^"]*@babel\/standalone[^"]*"[^>]*><\/script>/, '', 'le script Babel (unpkg)');

// 3. React servi depuis le site
const versionReact = require('react/package.json').version;
html = remplacer(html, /<script src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/,
  `<script src="vendor/react-${versionReact}.production.min.js"></script>`, 'le script React (unpkg)');
html = remplacer(html, /<script src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/,
  `<script src="vendor/react-dom-${versionReact}.production.min.js"></script>`, 'le script ReactDOM (unpkg)');

// 4. Copie du site
rmSync(sortie, { recursive: true, force: true, maxRetries: 5 });
mkdirSync(join(sortie, 'vendor'), { recursive: true });
for (const nom of readdirSync(racine)) {
  if (EXCLUS.has(nom) || nom === 'index.html') continue;
  cpSync(join(racine, nom), join(sortie, nom), { recursive: true });
}
const dossierPaquet = (nom) => dirname(require.resolve(`${nom}/package.json`));
cpSync(join(dossierPaquet('react'), 'umd', 'react.production.min.js'), join(sortie, 'vendor', `react-${versionReact}.production.min.js`));
cpSync(join(dossierPaquet('react-dom'), 'umd', 'react-dom.production.min.js'), join(sortie, 'vendor', `react-dom-${versionReact}.production.min.js`));
writeFileSync(join(sortie, 'index.html'), html);

console.log(`Site construit dans _site/ (index.html : ${(Buffer.byteLength(html) / 1024).toFixed(0)} Ko, React ${versionReact})`);
