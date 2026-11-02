import { describe, expect, it } from 'vitest';
import { MemoryRedis } from '../../src/memoryRedis.js';
import { SessionStore } from '../../src/security/session.js';

describe('MemoryRedis (poste principal sans Redis)', () => {
  it('set/get, EX, NX, del, incr, expire', async () => {
    const r = new MemoryRedis();
    expect(await r.set('a', '1', 'EX', 60)).toBe('OK');
    expect(await r.get('a')).toBe('1');
    expect(await r.set('a', '2', 'EX', 60, 'NX')).toBeNull();
    expect(await r.incr('n')).toBe(1);
    expect(await r.incr('n')).toBe(2);
    await r.set('t', 'x', 'PX', 5);
    await new Promise((res) => setTimeout(res, 15));
    expect(await r.get('t')).toBeNull();
    expect(await r.expire('missing', 10)).toBe(0);
    expect(await r.del('a', 'n')).toBe(2);
    r.disconnect();
  });
  it('ensembles, motifs et transactions', async () => {
    const r = new MemoryRedis();
    await r.multi().set('sess:1', 'v', 'EX', 60).sadd('usess:u', 'sess:1').expire('usess:u', 60).exec();
    expect(await r.smembers('usess:u')).toEqual(['sess:1']);
    await r.set('perm:c1:admin', 'x');
    await r.set('perm:c1:agent', 'y');
    await r.set('perm:c2:agent', 'z');
    expect((await r.keys('perm:c1:*')).sort()).toEqual(['perm:c1:admin', 'perm:c1:agent']);
    expect(await r.srem('usess:u', 'sess:1')).toBe(1);
    r.disconnect();
  });
  it('fonctionne avec le magasin de sessions (création, lecture, révocation)', async () => {
    const r = new MemoryRedis();
    const store = new SessionStore(r as never, 60, 3600);
    const { token } = await store.create({ userId: 'u1', companyId: 'c1', roleKey: 'admin', fullName: 'A', state: 'active' });
    expect((await store.get(token))?.userId).toBe('u1');
    await store.destroyAllForUser('u1');
    expect(await store.get(token)).toBeNull();
    r.disconnect();
  });
});
