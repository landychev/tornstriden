/* Återskapar förhandsvisningsbilderna: `npm run preview`
   Kräver en gång: npm install && npx playwright install chromium */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 8766;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(resolve => setTimeout(resolve, 700));
const shots = [
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
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    console.log('skrev', file);
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
