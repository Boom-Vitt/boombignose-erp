import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
  }
  if (isIP(address) !== 6) return true;
  let value = address.toLowerCase().split('%')[0]!;
  if (value.includes('.')) value = value.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`);
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(n => parseInt(n, 16));
  if (words.slice(0, 5).every(n => n === 0) && words[5] === 0xffff) {
    const a = words[6]!, b = words[7]!;
    return privateAddress(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  }
  return words.slice(0, 7).every(n => n === 0) && (words[7] === 0 || words[7] === 1)
    || (words[0]! & 0xfe00) === 0xfc00 || (words[0]! & 0xffc0) === 0xfe80 || (words[0]! & 0xff00) === 0xff00;
}

async function addresses(host: string) {
  host = host.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw new Error('refused: private network address');
  const found = isIP(host) ? [{ address: host, family: isIP(host) }] : await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!found.length || found.some(a => privateAddress(a.address))) throw new Error('refused: private network address');
  return found;
}

export async function fetchWeb(raw: string, signal: AbortSignal): Promise<string> {
  let url = new URL(raw);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only unauthenticated http/https URLs are supported');
    deadline.throwIfAborted();
    await addresses(url.hostname);
    const result = await new Promise<{ body: string; location?: string; html?: boolean }>((resolve, reject) => {
      const options: http.RequestOptions & { autoSelectFamily: boolean } = {
        method: 'GET', signal: deadline, autoSelectFamily: false,
        lookup(host, _options, callback) {
          addresses(host).then(found => callback(null, found[0]!.address, found[0]!.family), error => callback(error, '', 4));
        },
      };
      const req = (url.protocol === 'https:' ? https : http).request(url, options, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); resolve({ body: '', location: res.headers.location }); return;
        }
        if (!res.statusCode || res.statusCode >= 400) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) { req.destroy(new Error('Response exceeds 2 MB')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), html: res.headers['content-type']?.includes('text/html') }));
      });
      req.on('error', reject); req.end();
    });
    if (result.location) { url = new URL(result.location, url); continue; }
    if (!result.html) return result.body;
    return result.body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  throw new Error('Too many redirects');
}
