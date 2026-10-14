import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { Champ, Chargement, Modale, SecretUnique, dateHeure, messageErreur, useDonnees, useToast } from "../composants/ui";
import { ConfirmerAction } from "../composants/Confirmations";

interface Ent {
  id: string; code: string; raisonSociale: string; statut: string; pays: string; devise: string; rccm: string | null; niu: string | null;
  adresse: string | null; telephone: string | null; parametres: { mfaObligatoire: boolean; inactiviteJours: number };
  codeMaitre: { actif: boolean; creeLe: string | null; bloque: boolean };
}

export function Entreprise() {
  const { a, rafraichir } = useSession();
  const toast = useToast();
  const e = useDonnees(() => api.get<Ent>("/api/entreprise"), []);
  const [form, setForm] = useState({ raisonSociale: "", rccm: "", niu: "", adresse: "", telephone: "" });
  const [secu, setSecu] = useState({ mfaObligatoire: true, inactiviteJours: "90" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [regen, setRegen] = useState(false);
  const [nouveauCode, setNouveauCode] = useState<string | null>(null);
  useEffect(() => {
    if (!e.donnees) return;
    const d = e.donnees;
    setForm({ raisonSociale: d.raisonSociale, rccm: d.rccm ?? "", niu: d.niu ?? "", adresse: d.adresse ?? "", telephone: d.telephone ?? "" });
    setSecu({ mfaObligatoire: d.parametres.mfaObligatoire, inactiviteJours: String(d.parametres.inactiviteJours) });
  }, [e.donnees]);

  if (e.erreur) return <div className="alerte alerte-erreur">{e.erreur}</div>;
  if (!e.donnees) return <Chargement />;
  const d = e.donnees;
  const modifiable = a("company.update");
  const enregistrer = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErreur(null);
    const n = (v: string) => v.trim() || null;
    try {
      await api.patch("/api/entreprise", { raisonSociale: form.raisonSociale, rccm: n(form.rccm), niu: n(form.niu), adresse: n(form.adresse), telephone: n(form.telephone) });
      toast("Informations enregistrées."); e.recharger(); rafraichir();
    } catch (err) { setErreur(messageErreur(err)); }
  };
  const enregistrerSecu = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await api.patch("/api/entreprise", { parametres: { mfaObligatoire: secu.mfaObligatoire, inactiviteJours: Number(secu.inactiviteJours) } });
      toast("Paramètres de sécurité enregistrés."); e.recharger();
    } catch (err) { if ((err as { code?: string }).code !== "annulee") toast(messageErreur(err), true); }
  };
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <>
      <div className="entete-page"><div><h2>Entreprise</h2><p>Identité de l'espace {d.code} et règles de sécurité communes à tous les utilisateurs.</p></div></div>
      <div className="deux">
        <section className="panneau">
          <div className="entete-panneau"><div><h3>Identité</h3><p>Informations reprises sur les documents et rapports</p></div></div>
          <form onSubmit={enregistrer} style={{ display: "grid", gap: 12 }}>
            <Champ label="Raison sociale" valeur={form.raisonSociale} onChange={set("raisonSociale")} requis lectureSeule={!modifiable} />
            <div className="grille-champs">
              <Champ label="RCCM" valeur={form.rccm} onChange={set("rccm")} lectureSeule={!modifiable} aide="Registre du commerce et du crédit mobilier" />
              <Champ label="NIU" valeur={form.niu} onChange={set("niu")} lectureSeule={!modifiable} aide="Numéro d'identifiant unique (fiscal)" />
            </div>
            <Champ label="Adresse" valeur={form.adresse} onChange={set("adresse")} lectureSeule={!modifiable} />
            <div className="grille-champs">
              <Champ label="Téléphone" valeur={form.telephone} onChange={set("telephone")} lectureSeule={!modifiable} />
              <Champ label="Code entreprise" valeur={d.code} onChange={() => {}} lectureSeule aide="Identifiant de connexion, pas un mot de passe." />
            </div>
            <div className="grille-champs">
              <Champ label="Pays" valeur={d.pays} onChange={() => {}} lectureSeule />
              <Champ label="Devise" valeur={d.devise} onChange={() => {}} lectureSeule />
            </div>
            {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
            {modifiable && <div className="actions-form"><button className="btn btn-principal">Enregistrer</button></div>}
          </form>
        </section>
        <div style={{ display: "grid", gap: 16 }}>
          <section className="panneau">
            <div className="entete-panneau"><div><h3>Sécurité</h3><p>Modification réservée à l'administration, avec confirmation</p></div></div>
            <form onSubmit={enregistrerSecu} style={{ display: "grid", gap: 12 }}>
              <label className="case"><input type="checkbox" checked={secu.mfaObligatoire} disabled={!a("company.admin")} onChange={(x) => setSecu({ ...secu, mfaObligatoire: x.target.checked })} />
                <span>Double authentification obligatoire pour les rôles sensibles</span></label>
              <Champ label="Désactiver les comptes inutilisés après (jours)" type="number" min={0} max={3650} valeur={secu.inactiviteJours} onChange={(v) => setSecu({ ...secu, inactiviteJours: v })} lectureSeule={!a("company.admin")} aide="0 = jamais. Le dernier administrateur n'est jamais désactivé automatiquement." />
              {a("company.admin") && <div className="actions-form"><button className="btn btn-principal">Enregistrer</button></div>}
            </form>
          </section>
          <section className="panneau">
            <div className="entete-panneau"><div><h3>Code maître</h3><p>Récupération d'accès d'un administrateur</p></div></div>
            <p style={{ margin: "0 0 10px" }}>
              {d.codeMaitre.bloque ? <span className="badge badge-rouge">Bloqué après des essais incorrects</span>
                : d.codeMaitre.actif ? <span className="badge badge-vert">Actif</span> : <span className="badge badge-orange">Aucun code valable</span>}
              {d.codeMaitre.creeLe && <span className="discret"> · généré le {dateHeure(d.codeMaitre.creeLe)}</span>}
            </p>
            <p className="discret" style={{ margin: "0 0 12px" }}>Conservez-le imprimé, sous enveloppe scellée, chez le dirigeant. Il ne doit pas rester chez l'administrateur informatique. Il ne fonctionne qu'une fois.</p>
            {a("company.admin") && <button className="btn" onClick={() => setRegen(true)}>Générer un nouveau code maître</button>}
          </section>
        </div>
      </div>
      {regen && <ConfirmerAction titre="Générer un nouveau code maître ?" libelle="Générer" danger
        texte="L'ancien code cessera immédiatement de fonctionner. Le nouveau ne sera affiché qu'une seule fois."
        onValider={async () => { const r = await api.post<{ codeMaitre: string }>("/api/entreprise/code-maitre"); setNouveauCode(r.codeMaitre); e.recharger(); }}
        onFermer={() => setRegen(false)} />}
      {nouveauCode && (
        <Modale titre="Nouveau code maître">
          <SecretUnique valeur={nouveauCode} explication={<>Imprimez ou recopiez ce code <b>maintenant</b> : il ne sera plus jamais affiché. Remettez-le sous enveloppe scellée au dirigeant.</>} />
          <div className="actions-form"><button className="btn btn-principal" onClick={() => setNouveauCode(null)}>Je l'ai mis en lieu sûr</button></div>
        </Modale>
      )}
    </>
  );
}
