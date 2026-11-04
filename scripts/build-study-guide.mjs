// Gera os PDFs do material de estudo a partir de docs/study/*.html, com as capturas reais de
// docs/assets/screens. Não usa contas nem abre o XinoIA. Uso: npm run build:guide
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const study = path.join(root, 'docs', 'study');
const GUIDES = [
  ['guia.pt-BR.html', 'XinoIA-Guia-de-Estudo-pt-BR.pdf', 'Página'],
  ['guide.en.html', 'XinoIA-Study-Guide-en.pdf', 'Page'],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [source, output, pageWord] of GUIDES) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(study, source)).href, { waitUntil: 'networkidle' });
    const broken = await page.evaluate(() => [...document.images].filter((image) => !image.naturalWidth).map((image) => image.src));
    if (broken.length) throw new Error(`${source}: imagens quebradas: ${broken.join(', ')}`);
    const target = path.join(study, output);
    await page.pdf({
      path: target,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;padding:0 18mm;font:8px 'Segoe UI',sans-serif;color:#6b7782;display:flex;justify-content:space-between"><span>XinoIA</span><span>${pageWord} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    process.stdout.write(`${output}: ${Math.round(fs.statSync(target).size / 1024)} KB\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
