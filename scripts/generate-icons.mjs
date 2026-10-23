import fs from 'node:fs/promises';
import sharp from 'sharp';

await fs.mkdir('public/icons', { recursive: true });
const emblem = await fs.readFile('public/emblem.svg');

await sharp(emblem).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(emblem).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(emblem).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(emblem).resize(32, 32).png().toFile('public/favicon-32.png');

// Maskable icons need breathing room inside Android's safe zone.
const inner = await sharp(emblem).resize(400, 400).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#065f46' },
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile('public/icons/maskable-512.png');

console.log('PWA icons generated in public/icons');
