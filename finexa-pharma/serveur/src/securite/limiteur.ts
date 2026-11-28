/** Limite le nombre de tentatives par adresse IP sur une fenêtre glissante (en mémoire). */
export class Limiteur {
  private tentatives = new Map<string, number[]>();
  constructor(private max: number, private fenetreMs: number) {}

  /** Enregistre une tentative ; renvoie false si la limite est dépassée. */
  autoriser(cle: string, maintenant = Date.now()): boolean {
    const debut = maintenant - this.fenetreMs;
    const liste = (this.tentatives.get(cle) ?? []).filter((t) => t > debut);
    liste.push(maintenant);
    this.tentatives.set(cle, liste);
    if (this.tentatives.size > 10_000) this.purger(debut);
    return liste.length <= this.max;
  }

  private purger(debut: number) {
    for (const [k, v] of this.tentatives) if (v.every((t) => t <= debut)) this.tentatives.delete(k);
  }
}
