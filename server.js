// GRID WARS server: serves the static game AND relays multiplayer rooms
// over WebSocket. Run with `node server.js` (after `npm install`).
// The relay is deliberately dumb: it knows rooms and message routing,
// never game rules — the host browser is authoritative.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8123;
const ROOT = __dirname;
// Custom maps are stored as JSON files here. Override with MAPS_DIR (e.g. a
// Docker volume) to keep them across container restarts.
const MAPS_DIR = process.env.MAPS_DIR || path.join(ROOT, 'maps');
try { fs.mkdirSync(MAPS_DIR, { recursive: true }); } catch (e) { /* ignore */ }

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}
const validMapId = (id) => /^[a-z0-9_-]{1,90}$/i.test(id) ? id : null;

// Best guess at the machine's LAN IPv4 so invite links work from other devices
// (phones/tablets) on the same network instead of pointing at `localhost`.
// Prefers private LAN ranges and skips internal/loopback interfaces.
function lanIPv4() {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) addrs.push(i.address);
    }
  }
  const priv = addrs.find((a) =>
    /^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a));
  return priv || addrs[0] || null;
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/plain',
};

const server = http.createServer((req, res) => {
  // a malformed percent-escape (e.g. a bare "%") makes decodeURIComponent throw;
  // catch it here so one bad request can't crash the process (and every live room)
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('bad request'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  // host network info — lets the lobby build LAN-reachable invite URLs + QR
  if (urlPath === '/__net') {
    // PUBLIC_HOST lets Docker/hosted deployments advertise a reachable address
    // (the container's own IP from inside isn't reachable on the LAN).
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ip: process.env.PUBLIC_HOST || lanIPv4(), port: Number(PORT) }));
    return;
  }

  // ---------- custom maps API ----------
  if (urlPath === '/api/maps' && req.method === 'GET') {
    fs.readdir(MAPS_DIR, (err, files) => {
      const maps = [];
      for (const f of files || []) {
        if (!f.endsWith('.json')) continue;
        try {
          const m = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), 'utf8'));
          maps.push({
            id: f.replace(/\.json$/, ''), name: m.name || '(unnamed)',
            sizeKey: m.sizeKey || '?', factions: (m.factions || []).length,
            units: (m.placements || []).length,
          });
        } catch (e) { /* skip unreadable */ }
      }
      maps.sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, { maps });
    });
    return;
  }
  if (urlPath === '/api/maps' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      let m; try { m = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      if (!m || !Array.isArray(m.terrain) || !Array.isArray(m.placements)) {
        return sendJson(res, 400, { error: 'invalid map' });
      }
      const base = String(m.name || 'map').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map';
      const id = base + '-' + Math.random().toString(36).slice(2, 7);
      try { fs.writeFileSync(path.join(MAPS_DIR, id + '.json'), JSON.stringify(m)); }
      catch (e) { return sendJson(res, 500, { error: 'write failed' }); }
      sendJson(res, 200, { id, name: m.name || '(unnamed)' });
    });
    return;
  }
  if (urlPath.startsWith('/api/maps/')) {
    const id = validMapId(urlPath.slice('/api/maps/'.length));
    if (!id) return sendJson(res, 400, { error: 'bad id' });
    const mapFile = path.join(MAPS_DIR, id + '.json');
    if (req.method === 'GET') {
      fs.readFile(mapFile, (err, data) => {
        if (err) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
      return;
    }
    if (req.method === 'DELETE') {
      fs.unlink(mapFile, (err) => sendJson(res, err ? 404 : 200, err ? { error: 'not found' } : { ok: true }));
      return;
    }
  }

  const file = path.normalize(path.join(ROOT, urlPath));
  // contain strictly to ROOT — a bare startsWith() would also accept a sibling
  // dir sharing ROOT's name prefix (…/cms vs …/cms-secret) reached via "../"
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- rooms ----------

const rooms = new Map(); // roomId -> { hostId, clients: Map(clientId -> ws) }
let nextClient = 1;

function roomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// cap each frame at 1 MiB so a single oversized message can't balloon memory
const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });

wss.on('connection', (ws) => {
  const id = 'c' + (nextClient++);
  let myRoom = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'create') {
      let rid = roomId();
      while (rooms.has(rid)) rid = roomId();
      rooms.set(rid, { hostId: id, clients: new Map([[id, ws]]) });
      myRoom = rid;
      send(ws, { t: 'created', room: rid, id });

    } else if (m.t === 'join') {
      const room = rooms.get(m.room);
      if (!room) { send(ws, { t: 'err', m: 'NO SUCH GRID' }); return; }
      room.clients.set(id, ws);
      myRoom = m.room;
      send(ws, { t: 'joined', room: m.room, id });
      send(room.clients.get(room.hostId),
        { t: 'peer', id, role: m.role === 'play' ? 'play' : 'watch' });

    } else if (m.t === 'cast' && myRoom) {
      const room = rooms.get(myRoom);
      if (!room) return;
      for (const [cid, cws] of room.clients) {
        if (cid !== id) send(cws, { t: 'msg', from: id, d: m.d });
      }

    } else if (m.t === 'to' && myRoom) {
      const room = rooms.get(myRoom);
      if (!room) return;
      send(room.clients.get(m.target), { t: 'msg', from: id, d: m.d });
    }
  });

  ws.on('close', () => {
    const room = myRoom && rooms.get(myRoom);
    if (!room) return;
    room.clients.delete(id);
    const hostGone = room.hostId === id;
    for (const [, cws] of room.clients) {
      send(cws, { t: hostGone ? 'host-left' : 'left', id });
    }
    if (hostGone || room.clients.size === 0) rooms.delete(myRoom);
  });
});

server.listen(PORT, () => {
  console.log('GRID WARS online at http://localhost:' + PORT);
});
