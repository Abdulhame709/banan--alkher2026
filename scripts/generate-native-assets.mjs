import fs from 'node:fs/promises';
import sharp from 'sharp';

await fs.mkdir('resources', { recursive: true });
const emblem = await fs.readFile('public/emblem.svg');

await sharp(emblem).resize(1024, 1024).png().toFile('resources/icon.png');

const splashIcon = await sharp(emblem).resize(720, 720).png().toBuffer();
await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: '#f6f8f7' },
})
  .composite([{ input: splashIcon, gravity: 'center' }])
  .png()
  .toFile('resources/splash.png');

await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: '#065f46' },
})
  .composite([{ input: splashIcon, gravity: 'center' }])
  .png()
  .toFile('resources/splash-dark.png');

console.log('Capacitor resources generated');
