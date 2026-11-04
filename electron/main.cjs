const { app, BrowserWindow, shell } = require('electron');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let localServer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.setAppUserModelId('com.ssgdesign.clothingswapstudio');

async function startLocalServer() {
  const projectRoot = path.resolve(__dirname, '..');
  const backgroundPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backgrounds')
    : path.join(projectRoot, 'assets', 'backgrounds');
  const outputPath = path.join(app.getPath('documents'), 'Clothing Swap Studio', '02_OUTPUT');
  await mkdir(outputPath, { recursive: true });
  process.env.CLOTHING_SWAP_BACKGROUND_DIR = backgroundPath;
  process.env.CLOTHING_SWAP_OUTPUT_DIR = outputPath;

  const serverModuleUrl = pathToFileURL(path.join(projectRoot, 'server.mjs')).href;
  const { server } = await import(serverModuleUrl);
  localServer = server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server.address().port;
}

async function createWindow() {
  const port = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f3f3ef',
    title: 'Clothing Swap Studio',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const appUrl = `http://127.0.0.1:${port}/`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) event.preventDefault();
  });
  await mainWindow.loadURL(appUrl);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (localServer?.listening) localServer.close();
});
