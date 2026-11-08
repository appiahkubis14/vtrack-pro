#!/usr/bin/env node
/**
 * Pretends to be a GT06 GPS tracker: logs in over TCP and sends position reports, so vehicles move on the live map
 * without real hardware. The device (its IMEI) must already exist, e.g. from scripts/seed-demo.js.
 *
 *   node scripts/simulate-tracker.js --imei 860000000XXXXX --from 5.6037,-0.1870 --to 5.6300,-0.1500 --speed 30 --interval 2
 *   node scripts/simulate-tracker.js --imei ... --lat 5.60 --lng -0.19 --speed 0 --count 5     (stand still: parked or idling with --acc 1)
 *   --host 127.0.0.1 --port 5023   where the API listens for GT06 devices
 *   --loop                          drive back and forth until stopped
 *   --acc 1|0                       engine on (default 1 while moving)
 */
const net = require('net');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const imei = arg('imei'); if (!imei) { console.error('Give --imei'); process.exit(1); }
const host = arg('host', '127.0.0.1'), port = Number(arg('port', 5023));
const interval = Number(arg('interval', 2)) * 1000, speed = Number(arg('speed', 30)), count = Number(arg('count', 0));
const parse = (s) => s.split(',').map(Number);
let a = arg('from') ? parse(arg('from')) : [Number(arg('lat', 5.6037)), Number(arg('lng', -0.187))];
let b = arg('to') ? parse(arg('to')) : a;

const { login: loginFrame, location } = require('./lib/gt06');
const login = () => loginFrame(imei);
const bearing = (p, q) => { const r = Math.PI / 180, y = Math.sin((q[1] - p[1]) * r) * Math.cos(q[0] * r), x = Math.cos(p[0] * r) * Math.sin(q[0] * r) - Math.sin(p[0] * r) * Math.cos(q[0] * r) * Math.cos((q[1] - p[1]) * r); return ((Math.atan2(y, x) / r) + 360) % 360; };
const meters = (p, q) => { const r = Math.PI / 180, dl = (q[0] - p[0]) * r, dn = (q[1] - p[1]) * r, s = Math.sin(dl / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin(dn / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(s)); };

const sock = net.connect(port, host, () => { console.log(`connected to ${host}:${port}, logging in as ${imei}`); sock.write(login()); });
sock.on('error', (e) => { console.error('connection failed:', e.message); process.exit(1); });
sock.on('data', () => {});
let pos = [...a], n = 2, sent = 0;
const still = a[0] === b[0] && a[1] === b[1];
setTimeout(() => {
  const t = setInterval(() => {
    const acc = Number(arg('acc', still && speed === 0 ? 0 : 1));
    let heading = still ? 0 : bearing(pos, b);
    if (!still) {
      const step = (speed / 3.6) * (interval / 1000), left = meters(pos, b);
      if (left <= step) { pos = [...b]; if (has('loop')) { [a, b] = [b, a]; } }
      else { const f = step / left; pos = [pos[0] + (b[0] - pos[0]) * f, pos[1] + (b[1] - pos[1]) * f]; }
    }
    sock.write(location(pos[0], pos[1], still ? 0 : speed, heading, acc, n++));
    sent++;
    process.stdout.write(`\rsent ${sent}  at ${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}  ${still ? 0 : speed} km/h   `);
    const arrived = !still && !has('loop') && meters(pos, b) < 1;
    if ((count && sent >= count) || arrived) { clearInterval(t); setTimeout(() => { console.log('\ndone'); sock.end(); process.exit(0); }, 500); }
  }, interval);
}, 1500);
