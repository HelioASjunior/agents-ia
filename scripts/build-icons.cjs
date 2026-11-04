// Gera icon.png e icon.ico a partir de icon.svg, usando o Electron como renderizador.
// O resultado fica versionado, então só é preciso rodar ao mudar o ícone:
//   npx electron scripts/build-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const build = path.resolve(__dirname, '../apps/desktop/build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(build, 'icon.svg'), 'utf8').replace('<svg ', '<svg width="1024" height="1024" ');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();

  const images = SIZES.map((size) => ({ size, data: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((item) => item.data)]));
  fs.writeFileSync(path.join(build, 'icon.png'), image.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  process.stdout.write('Ícones gerados.\n');
  app.exit(0);
});
