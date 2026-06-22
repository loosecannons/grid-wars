// Integration test for the WebSocket relay's host-authority hardening.
// Playwright can't drive raw sockets, so this runs standalone:  node tests/relay.test.cjs
// Spawns server.js on a private port, connects raw ws clients, asserts the
// security properties, and exits non-zero on any failure.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = '8162';
const URL = 'ws://127.0.0.1:' + PORT;
const ROOT = path.join(__dirname, '..');

const checks = [];
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); };

function finish(srv) {
  srv.kill();
  let failed = 0;
  for (const c of checks) {
    console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name);
    if (!c.pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}

const srv = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT, MAPS_DIR: path.join(__dirname, '.maps-tmp'), BIND_HOST: '127.0.0.1' },
  stdio: 'ignore',
});

const state = { joinerGotHostCast: null, hostGotJoinerCast: null, hostGotForgedTo: false, aPeerGotHostLeft: false };

setTimeout(() => {
  const host = new WebSocket(URL);
  let hostId = null;
  let roomA = null;

  host.on('open', () => host.send(JSON.stringify({ t: 'create' })));
  host.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'created' && !roomA) {
      hostId = m.id; roomA = m.room;
      const joiner = new WebSocket(URL);
      joiner.on('open', () => joiner.send(JSON.stringify({ t: 'join', room: roomA, role: 'play' })));
      joiner.on('message', (jraw) => {
        const jm = JSON.parse(jraw);
        if (jm.t === 'joined') {
          host.send(JSON.stringify({ t: 'cast', d: { k: 'start' } }));   // host → joiner
          joiner.send(JSON.stringify({ t: 'cast', d: { k: 'act' } }));   // joiner → host
          joiner.send(JSON.stringify({ t: 'to', target: hostId, d: { k: 'welcome' } })); // forged, must drop
        } else if (jm.t === 'msg') {
          state.joinerGotHostCast = { host: jm.host, k: jm.d.k };
        } else if (jm.t === 'host-left') {
          state.aPeerGotHostLeft = true; // orphan fix: host abandoning room A notifies its peers
        }
      });
    } else if (m.t === 'msg') {
      if (m.d.k === 'act') state.hostGotJoinerCast = { host: m.host, k: m.d.k };
      if (m.d.k === 'welcome') state.hostGotForgedTo = true;
    }
  });

  // after the cast/to round-trip, have the host create a SECOND room on the same
  // socket — leaveRoom() must evict it from room A and tell the joiner
  setTimeout(() => host.send(JSON.stringify({ t: 'create' })), 600);

  setTimeout(() => {
    ok('host cast is stamped host:true to peers', state.joinerGotHostCast && state.joinerGotHostCast.host === true);
    ok('non-host cast is stamped host:false', state.hostGotJoinerCast && state.hostGotJoinerCast.host === false);
    ok('forged directed welcome from a non-host is dropped', state.hostGotForgedTo === false);
    ok('abandoning a room (re-create) evicts the socket and notifies peers', state.aPeerGotHostLeft === true);
    finish(srv);
  }, 1400);
}, 800);

setTimeout(() => { console.error('timeout'); finish(srv); }, 8000);
