// gauge licensing — offline ed25519 verification, no phone-home, no gate.
// A key is `GAUGE-<payload>-<b64url signature>`; the payload is signed by
// gauge.joey.win at purchase and verified here against the embedded public
// key. Licensed or not, every feature works — the meter just says which.
import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PUBLIC_KEY = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXke4aJZlinAidyn3q6+nF2pnDdBLeHs42PXVQLzzUnM=
-----END PUBLIC KEY-----`);

const LICENSE_FILE = path.join(
  process.env.GAUGE_DATA_DIR || path.join(os.homedir(), '.cache', 'gauge'),
  'license.json',
);

export function checkKey(key) {
  // payload is version.id8.yyyymmdd; sig is base64url (which itself contains
  // hyphens, so the payload pattern must be explicit — a greedy split breaks)
  const m = /^GAUGE-(\d+\.[0-9a-f]{8}\.\d{8})-([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return null;
  const [, payload, sig] = m;
  try {
    const ok = verify(null, Buffer.from(payload), PUBLIC_KEY, Buffer.from(sig, 'base64url'));
    return ok ? { payload } : null;
  } catch {
    return null;
  }
}

export function activate(key) {
  const parsed = checkKey(key);
  if (!parsed) return false;
  fs.writeFileSync(LICENSE_FILE, JSON.stringify({ key: key.trim(), activated: new Date().toISOString() }));
  return true;
}

export function licensed() {
  try {
    const { key } = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    return checkKey(key) !== null;
  } catch {
    return false;
  }
}
