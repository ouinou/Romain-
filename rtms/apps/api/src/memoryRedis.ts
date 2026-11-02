/**
 * Remplaçant de Redis en mémoire, pour le serveur local (un seul processus sur le poste
 * principal, sans Internet). Implémente uniquement les commandes utilisées par RTMS.
 * Les sessions sont perdues au redémarrage du poste principal : les utilisateurs se reconnectent.
 */
type Entry = { v: string | Set<string>; exp?: number };

export class MemoryRedis {
  private m = new Map<string, Entry>();
  private timer = setInterval(() => this.sweep(), 60_000);
  constructor() { this.timer.unref(); }

  private live(k: string): Entry | undefined {
    const e = this.m.get(k);
    if (e && e.exp !== undefined && e.exp <= Date.now()) { this.m.delete(k); return undefined; }
    return e;
  }
  private sweep() { for (const k of [...this.m.keys()]) this.live(k); }

  async get(k: string): Promise<string | null> { const e = this.live(k); return e && typeof e.v === 'string' ? e.v : null; }
  async set(k: string, v: string, ...args: (string | number)[]): Promise<'OK' | null> {
    let exp: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === 'EX') exp = Date.now() + Number(args[++i]) * 1000;
      else if (a === 'PX') exp = Date.now() + Number(args[++i]);
      else if (a === 'NX') nx = true;
    }
    if (nx && this.live(k)) return null;
    this.m.set(k, { v: String(v), exp });
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> { let n = 0; for (const k of keys.flat()) if (this.m.delete(k)) n++; return n; }
  async expire(k: string, s: number): Promise<number> { const e = this.live(k); if (!e) return 0; e.exp = Date.now() + s * 1000; return 1; }
  async incr(k: string): Promise<number> { const e = this.live(k); const n = (e && typeof e.v === 'string' ? Number(e.v) : 0) + 1; this.m.set(k, { v: String(n), exp: e?.exp }); return n; }
  async sadd(k: string, ...vals: string[]): Promise<number> {
    let e = this.live(k);
    if (!e || typeof e.v === 'string') { e = { v: new Set() }; this.m.set(k, e); }
    const s = e.v as Set<string>; let n = 0;
    for (const v of vals) if (!s.has(v)) { s.add(v); n++; }
    return n;
  }
  async srem(k: string, ...vals: string[]): Promise<number> { const e = this.live(k); if (!e || typeof e.v === 'string') return 0; let n = 0; for (const v of vals) if (e.v.delete(v)) n++; return n; }
  async smembers(k: string): Promise<string[]> { const e = this.live(k); return e && typeof e.v !== 'string' ? [...e.v] : []; }
  async keys(pattern: string): Promise<string[]> {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return [...this.m.keys()].filter((k) => this.live(k) && re.test(k));
  }
  async ping(): Promise<'PONG'> { return 'PONG'; }
  async flushdb(): Promise<'OK'> { this.m.clear(); return 'OK'; }
  disconnect() { clearInterval(this.timer); }
  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...a: Parameters<MemoryRedis['set']>) => { ops.push(() => this.set(...a)); return chain; },
      sadd: (k: string, ...v: string[]) => { ops.push(() => this.sadd(k, ...v)); return chain; },
      expire: (k: string, s: number) => { ops.push(() => this.expire(k, s)); return chain; },
      del: (...k: string[]) => { ops.push(() => this.del(...k)); return chain; },
      exec: async () => { const r: [null, unknown][] = []; for (const op of ops) r.push([null, await op()]); return r; },
    };
    return chain;
  }
}
