/* Återskapar förhandsvisningsbilderna: `npm run preview`
   Kräver en gång: npm install && npx playwright install chromium */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 8766;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(resolve => setTimeout(resolve, 700));
const shots = [
  { page: 'match.html', file: 'match-forhandsvisning.jpg', width: 1366, height: 1200 },
  { page: 'spelbord.html', file: 'spelbord-forhandsvisning.jpg', width: 1366, height: 1225 },
  { page: 'effekter.html', file: 'bildeffekter-forhandsvisning.jpg', width: 1280, height: 1250 },
  { page: 'textkort.html', file: 'tjugo-kort-forhandsvisning.jpg', width: 1366, height: 1285 }
];
try {
  const browser = await chromium.launch();
  for (const { page: path, file, width, height } of shots) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: 'light' });
    await page.goto(`http://127.0.0.1:${PORT}/${path}`);
    await page.waitForTimeout(600);
    // Stäng hjälprutorna (spelförklaring och bytesförklaring) så att bilden visar bordet.
    await page.evaluate(() => { let d; while ((d = document.querySelector('dialog[open]'))) d.close(); });
    await page.waitForTimeout(200);
    // Även målningar nedanför synfältet ska vara avkodade innan bilden tas.
    await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode(); }));
    });
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    console.log('skrev', file);
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
