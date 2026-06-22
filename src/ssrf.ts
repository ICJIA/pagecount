import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { CountError } from './errors';

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 127) return true;             // unspecified / loopback
  if (a === 10) return true;                          // private
  if (a === 172 && b >= 16 && b <= 31) return true;   // private
  if (a === 192 && b === 168) return true;            // private
  if (a === 169 && b === 254) return true;            // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  return false;
}

// Expand an IPv6 string (with :: shorthand and/or an embedded dotted-quad tail)
// into its 8 16-bit hextets. Returns null if it cannot be parsed.
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // Convert an embedded dotted-quad tail (e.g. ::ffff:127.0.0.1) into two hextets.
  const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) {
    const p = m[2]!.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const h1 = (((p[0]! << 8) | p[1]!) >>> 0).toString(16);
    const h2 = (((p[2]! << 8) | p[3]!) >>> 0).toString(16);
    s = `${m[1]}${h1}:${h2}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function ipv6IsPrivate(ip: string): boolean {
  const h = expandIPv6(ip);
  if (!h) return false;
  // :: (unspecified) and ::1 (loopback)
  if (h.slice(0, 7).every((x) => x === 0) && (h[7] === 0 || h[7] === 1)) return true;
  // link-local fe80::/10
  if ((h[0]! & 0xffc0) === 0xfe80) return true;
  // unique-local fc00::/7
  if ((h[0]! & 0xfe00) === 0xfc00) return true;
  // IPv4-mapped ::ffff:a.b.c.d  (hextets 0..4 == 0, hextet5 == 0xffff)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const v4 = `${(h[6]! >> 8) & 0xff}.${h[6]! & 0xff}.${(h[7]! >> 8) & 0xff}.${h[7]! & 0xff}`;
    return ipv4IsPrivate(v4);
  }
  // IPv4-compatible ::a.b.c.d (deprecated) — treat the embedded v4 as the address
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && (h[6] !== 0 || h[7] !== 0)) {
    const v4 = `${(h[6]! >> 8) & 0xff}.${h[6]! & 0xff}.${(h[7]! >> 8) & 0xff}.${h[7]! & 0xff}`;
    return ipv4IsPrivate(v4);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4IsPrivate(ip);
  if (v === 6) return ipv6IsPrivate(ip);
  return false;
}

/**
 * Reject a URL whose host is (or DNS-resolves to) a loopback/private/link-local
 * address, to mitigate SSRF. NOTE: a residual TOCTOU/DNS-rebinding window exists —
 * the address validated here may differ from the one the socket later connects to.
 * Accepted limitation for a v1 tool over public datasets.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CountError('network-error', `invalid url: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CountError('network-error', `unsupported url scheme: ${url}`);
  }
  const host = parsed.hostname;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new CountError('network-error', `blocked non-public host: ${bare}`);
    return;
  }
  let addrs;
  try {
    addrs = await lookup(bare, { all: true });
  } catch {
    throw new CountError('network-error', `dns lookup failed: ${bare}`);
  }
  if (addrs.length === 0) {
    throw new CountError('network-error', `dns lookup empty: ${bare}`);
  }
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new CountError('network-error', `blocked non-public host: ${bare} -> ${a.address}`);
    }
  }
}
