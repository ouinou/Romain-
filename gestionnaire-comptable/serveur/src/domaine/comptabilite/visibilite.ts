/**
 * Comptes protégés : un compte est masqué pour l'utilisateur si au moins un groupe protégé dont le préfixe
 * correspond à son numéro exige une permission que l'utilisateur n'a pas.
 *
 * Renvoie une condition SQL à placer dans un WHERE. `alias` désigne la table accounts ;
 * `paramPermissions` est le numéro du paramètre ($n) qui contient le tableau des permissions de l'utilisateur.
 */
export const compteMasque = (alias: string, paramPermissions: number) =>
  `EXISTS (SELECT 1 FROM protected_account_groups g
            WHERE ${alias}.account_number LIKE g.prefix || '%'
              AND NOT (g.required_permission = ANY($${paramPermissions}::text[])))`;
