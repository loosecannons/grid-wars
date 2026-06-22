// Electron wrapper — packages GRID WARS as a Windows desktop app. It starts the
// bundled server (static files + the WebSocket multiplayer relay) on a free
// local port, then opens it in a native window. Single-player and hosting/
// joining online games both work the same as the web build. (three.js and the
// Orbitron font still load from a CDN at runtime, so internet is needed.)
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');

// grab a free localhost port so a second copy (or anything on 8123) never clashes
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', () => resolve(8123));
  });
}

// poll until the server is actually accepting connections, then continue
function waitForServer(port, cb, tries = 60) {
  const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.destroy(); cb(); });
  req.on('error', () => { if (tries > 0) setTimeout(() => waitForServer(port, cb, tries - 1), 100); else cb(); });
}

let port = 8123;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#01060b', title: 'GRID WARS', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadURL('http://127.0.0.1:' + port + '/');
  // external links (e.g. the manual's GitHub/Docker links) open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(async () => {
  port = await freePort();
  process.env.PORT = String(port);
  // custom maps must live somewhere writable (the packaged app is read-only)
  process.env.MAPS_DIR = path.join(app.getPath('userData'), 'maps');
  // the desktop app only ever loads 127.0.0.1 — keep the server loopback-only so
  // the unauthenticated maps API + WS relay aren't exposed to the whole LAN
  process.env.BIND_HOST = '127.0.0.1';
  require(path.join(__dirname, '..', 'server.js')); // start HTTP + WS relay
  waitForServer(port, createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
