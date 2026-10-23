import { useState } from "react";
import { api, qs } from "../../api";
import { useSession } from "../../session";
import { Champ, Chargement, Modale, messageErreur, useDonnees, useRetarde, useToast } from "../../composants/ui";

interface Client { id: string; nom: string; niu: string | null; telephone: string | null; email: string | null; adresse: string | null; factures: number }

export function Clients() {
  const { a } = useSession();
  const [recherche, setRecherche] = useState("");
  const [creation, setCreation] = useState(false);
  const rech = useRetarde(recherche);
  const liste = useDonnees(() => api.get<Client[]>(`/api/ventes/clients${qs({ recherche: rech })}`), [rech]);
  return (
    <>
      <div className="entete-page">
        <div><h2>Clients</h2><p>Fiches clients réutilisées lors des ventes. Le NIU figure sur la facture lorsqu'il est renseigné.</p></div>
        {a("sales.create") && <button className="btn btn-principal" onClick={() => setCreation(true)}>+ Nouveau client</button>}
      </div>
      <section className="panneau">
        <div className="filtres" role="search"><label className="cache-visuel" htmlFor="cl-r">Rechercher</label>
          <input id="cl-r" className="filtre" type="search" placeholder="Nom, téléphone ou NIU…" value={recherche} onChange={(e) => setRecherche(e.target.value)} /></div>
        {liste.erreur ? <div className="alerte alerte-erreur">{liste.erreur}</div> : !liste.donnees ? <Chargement /> : liste.donnees.length === 0 ? <div className="vide">Aucun client enregistré.</div> : (
          <div className="tableau-conteneur"><table>
            <thead><tr><th>Client</th><th>NIU</th><th>Téléphone</th><th>Adresse</th><th className="montant">Factures</th></tr></thead>
            <tbody>{liste.donnees.map((c) => (
              <tr key={c.id}><td><b>{c.nom}</b>{c.email && <><br /><span className="discret">{c.email}</span></>}</td><td className="num">{c.niu ?? "—"}</td><td>{c.telephone ?? "—"}</td><td>{c.adresse ?? "—"}</td>
                <td className="montant">{c.factures ? <a href={`#/ventes?client=${encodeURIComponent(c.nom)}`}>{c.factures}</a> : 0}</td></tr>))}
            </tbody></table></div>
        )}
      </section>
      {creation && <NouveauClient onFermer={() => setCreation(false)} onFin={liste.recharger} />}
    </>
  );
}

function NouveauClient({ onFermer, onFin }: { onFermer: () => void; onFin: () => void }) {
  const toast = useToast();
  const [c, setC] = useState({ nom: "", niu: "", telephone: "", email: "", adresse: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault(); setErreur(null);
    try { await api.post("/api/ventes/clients", { nom: c.nom, niu: c.niu || undefined, telephone: c.telephone || undefined, email: c.email || undefined, adresse: c.adresse || undefined }); toast("Client enregistré."); onFin(); onFermer(); }
    catch (err) { setErreur(messageErreur(err)); }
  };
  const set = (k: keyof typeof c) => (v: string) => setC({ ...c, [k]: v });
  return (
    <Modale titre="Nouveau client" onFermer={onFermer}>
      <form onSubmit={envoyer} style={{ display: "grid", gap: 12 }}>
        <Champ label="Nom ou raison sociale" valeur={c.nom} onChange={set("nom")} requis autoFocus />
        <div className="grille-champs"><Champ label="NIU" valeur={c.niu} onChange={set("niu")} /><Champ label="Téléphone" valeur={c.telephone} onChange={set("telephone")} /></div>
        <div className="grille-champs"><Champ label="E-mail" type="email" valeur={c.email} onChange={set("email")} /><Champ label="Adresse" valeur={c.adresse} onChange={set("adresse")} /></div>
        {erreur && <div className="alerte alerte-erreur" role="alert">{erreur}</div>}
        <div className="actions-form"><button type="button" className="btn" onClick={onFermer}>Annuler</button><button className="btn btn-principal">Enregistrer</button></div>
      </form>
    </Modale>
  );
}
