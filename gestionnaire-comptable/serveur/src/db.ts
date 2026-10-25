import pg from "pg";

export type Client = pg.PoolClient;
export type Pool = pg.Pool;

export function creerPool(chaine: string, max = 20): Pool {
  return new pg.Pool({ connectionString: chaine, max });
}

/**
 * Exécute fn dans une transaction. Si entrepriseId est fourni, il est fixé comme contexte
 * (app.company_id) : la Row-Level Security limite alors toutes les requêtes à cette entreprise.
 */
export async function transaction<T>(pool: Pool, entrepriseId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (entrepriseId) await c.query("SELECT set_config('app.company_id', $1, true)", [entrepriseId]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
