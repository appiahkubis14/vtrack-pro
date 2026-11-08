/** Builds GT06 tracker packets (login and location with engine flag) for the simulator and the tests. */
function crc16(buf) { let c = 0xffff; for (const x of buf) { c ^= x; for (let i = 0; i < 8; i++) c = c & 1 ? (c >> 1) ^ 0x8408 : c >> 1; } return (~c) & 0xffff; }
function frame(proto, content, serial) {
  const body = Buffer.concat([Buffer.from([content.length + 5, proto]), content, Buffer.from([serial >> 8, serial & 255])]);
  const crc = crc16(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), body, Buffer.from([crc >> 8, crc & 255, 0x0d, 0x0a])]);
}
/** A 15-character IMEI is packed into 8 BCD bytes with a leading 0. */
function login(imei, serial = 1) { return frame(0x01, Buffer.from(('0' + imei).padStart(16, '0'), 'hex'), serial); }
function location(lat, lng, kmh, heading, acc, serial, when = new Date()) {
  const d = when;
  const c = Buffer.alloc(18 + 8 + 1 + 1 + 1 + 4);
  [d.getUTCFullYear() - 2000, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].forEach((v, i) => c.writeUInt8(v, i));
  c.writeUInt8(0xc8 | 8, 6); // 8 satellites
  c.writeUInt32BE(Math.round(Math.abs(lat) * 60 * 30000), 7);
  c.writeUInt32BE(Math.round(Math.abs(lng) * 60 * 30000), 11);
  c.writeUInt8(Math.min(255, Math.round(kmh)), 15);
  // course/status: bit10 = north, bit11 = east, bit12 = GPS fixed
  c.writeUInt16BE(((lat >= 0 ? 1 : 0) << 10) | ((lng >= 0 ? 1 : 0) << 11) | (1 << 12) | (Math.round(heading) & 0x3ff), 16);
  c.writeUInt8(acc, 26);
  return frame(0x22, c, serial);
}
module.exports = { crc16, frame, login, location };
