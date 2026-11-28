import type { Evenement } from "../domaine/audit.js";

/** Erreur renvoyée au client. Si `audit` est fourni, l'échec est journalisé à part (la transaction est annulée). */
export class ErreurHttp extends Error {
  constructor(public statut: number, public code: string, message: string, public audit?: Evenement) {
    super(message);
  }
}

export const nonTrouve = (quoi = "Élément") => new ErreurHttp(404, "introuvable", `${quoi} introuvable.`);
