// ITI – quatre objets 3D réalistes animés en temps réel (tournevis, caméra, panneau solaire, éolienne).
// Monté automatiquement sur chaque <div class="iti-3d-scene" data-objet="..."> de la page.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const calme = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Matériaux ----------
function materiaux() {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 }),
    acier: new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.9, roughness: 0.32 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.85, roughness: 0.38 }),
    orange: new THREE.MeshPhysicalMaterial({ color: 0xe8501f, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    noirMat: new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.55 }),
    caoutchouc: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.85 }),
    blanc: new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    verre: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    lentille: new THREE.MeshPhysicalMaterial({ color: 0x1d3c6b, metalness: 0.5, roughness: 0.08, clearcoat: 1, iridescence: 0.6 }),
    cellules: new THREE.MeshPhysicalMaterial({ color: 0x13306a, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 }),
    bois: new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.75 }),
    beton: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.9 }),
  };
}

// ---------- Objets ----------
function tournevis(M) {
  const g = new THREE.Group();
  // Planche en bois
  const planche = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 1.2), M.bois);
  planche.position.y = -0.16; planche.receiveShadow = true; g.add(planche);
  // Vis : tête cruciforme + corps fileté
  const vis = new THREE.Group();
  const tete = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.08, 40), M.chrome); tete.position.y = 0.04;
  const fente1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.035), M.noirMat); fente1.position.y = 0.075;
  const fente2 = fente1.clone(); fente2.rotation.y = Math.PI / 2;
  const corps = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.02, 0.6, 24), M.chrome); corps.position.y = -0.3;
  const filets = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.062 - i * 0.004, 0.012, 8, 24), M.chrome);
    f.rotation.x = Math.PI / 2 + 0.12; f.position.y = -0.06 - i * 0.06; filets.push(f);
  }
  vis.add(tete, fente1, fente2, corps, ...filets);
  g.add(vis);
  // Tournevis : manche bi-matière, tige chromée, pointe cruciforme
  const tv = new THREE.Group();
  const profil = [[0, 0], [0.16, 0], [0.2, 0.08], [0.21, 0.5], [0.24, 0.9], [0.23, 1.15], [0.16, 1.28], [0, 1.3]].map(([x, y]) => new THREE.Vector2(x, y));
  const manche = new THREE.Mesh(new THREE.LatheGeometry(profil, 48), M.orange); manche.position.y = 1.15; manche.castShadow = true;
  const bague = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.28, 48), M.caoutchouc); bague.position.y = 1.62;
  const rainures = [];
  for (let i = 0; i < 8; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.05), M.caoutchouc);
    const a = (i / 8) * Math.PI * 2; r.position.set(Math.cos(a) * 0.205, 1.62, Math.sin(a) * 0.205); r.rotation.y = -a; rainures.push(r);
  }
  const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 24), M.chrome); tige.position.y = 0.62; tige.castShadow = true;
  const pointe = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), M.acier); pointe.rotation.x = Math.PI; pointe.position.y = 0.04;
  tv.add(manche, bague, ...rainures, tige, pointe);
  g.add(tv);
  g.userData.anime = (t) => {
    const cycle = (t % 4) / 4;                // 4 s par vissage
    const enfonce = Math.min(cycle / 0.85, 1); // descente puis pause
    const y = 0.42 - enfonce * 0.42;           // la vis s'enfonce dans le bois
    const angle = enfonce * Math.PI * 8;
    vis.position.y = y; vis.rotation.y = angle;
    tv.position.y = y + 0.08; tv.rotation.y = angle;
  };
  g.userData.camera = { pos: [3.9, 2.9, 5.4], cible: [0, 1.3, 0] };
  return g;
}

function camera(M) {
  const g = new THREE.Group();
  const mur = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 1.6), M.beton); mur.position.set(-1.25, 0.3, 0); mur.receiveShadow = true; g.add(mur);
  const platine = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.07, 40), M.blanc); platine.rotation.z = Math.PI / 2; platine.position.set(-1.15, 0.55, 0); g.add(platine);
  const pivot = new THREE.Group(); pivot.position.set(-1.1, 0.55, 0); g.add(pivot);
  const bras = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 24), M.blanc); bras.rotation.z = Math.PI / 2; bras.position.x = 0.27; bras.castShadow = true; pivot.add(bras);
  const rotule = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 16), M.blanc); rotule.position.x = 0.55; pivot.add(rotule);
  const tete = new THREE.Group(); tete.position.set(0.58, 0.16, 0); pivot.add(tete);
  const boitier = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.15, 48), M.blanc); boitier.rotation.z = Math.PI / 2; boitier.position.x = 0.45; boitier.castShadow = true;
  const visiere = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 1.25, 48, 1, true, -Math.PI * 0.55, Math.PI * 1.1), M.blanc);
  visiere.rotation.z = Math.PI / 2; visiere.position.set(0.52, 0.02, 0); visiere.material = M.blanc.clone(); visiere.material.side = THREE.DoubleSide;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.03, 48), M.verre); face.rotation.z = Math.PI / 2; face.position.x = 1.03;
  const objectif = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 16), M.lentille); objectif.scale.set(0.5, 1, 1); objectif.position.x = 1.05;
  const leds = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a10, emissiveIntensity: 0 }));
    l.position.set(1.05, Math.sin(a) * 0.17, Math.cos(a) * 0.17); leds.push(l);
  }
  tete.add(boitier, visiere, face, objectif, ...leds);
  g.userData.anime = (t) => {
    pivot.rotation.y = Math.sin(t * 0.55) * 0.45;
    tete.rotation.z = -0.18 + Math.sin(t * 0.37) * 0.06;
    const allume = Math.sin(t * 3) > 0.2 ? 1.6 : 0.15;
    leds.forEach((l) => (l.material.emissiveIntensity = allume));
  };
  g.rotation.y = -1.0; g.userData.camera = { pos: [0.9, 1.2, 3.7], cible: [0.15, 0.55, 0] };
  return g;
}

function panneau(M) {
  const g = new THREE.Group();
  const support = new THREE.Group(); g.add(support);
  const L = 2.4, H = 1.5;
  const plaque = new THREE.Group(); plaque.position.y = 0.95; plaque.rotation.x = 0.55; support.add(plaque);
  const cadre = new THREE.Mesh(new THREE.BoxGeometry(L + 0.1, 0.07, H + 0.1), M.alu); cadre.castShadow = true; plaque.add(cadre);
  const verre = new THREE.Mesh(new THREE.BoxGeometry(L, 0.075, H), M.cellules); verre.position.y = 0.005; plaque.add(verre);
  // Quadrillage des cellules (barres argentées)
  const barres = [];
  for (let i = 1; i < 6; i++) { const b = new THREE.BoxGeometry(0.012, 0.002, H); b.translate(-L / 2 + (i * L) / 6, 0.044, 0); barres.push(b); }
  for (let j = 1; j < 10; j++) { const b = new THREE.BoxGeometry(L, 0.002, 0.008); b.translate(0, 0.044, -H / 2 + (j * H) / 10); barres.push(b); }
  plaque.add(new THREE.Mesh(mergeGeometries(barres), new THREE.MeshStandardMaterial({ color: 0xdfe6f1, metalness: 0.8, roughness: 0.3 })));
  // Pieds
  [[-0.9, 0.5], [0.9, 0.5], [-0.9, -0.42], [0.9, -0.42]].forEach(([x, z], k) => {
    const h = k < 2 ? 0.55 : 1.25;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), M.acier); p.position.set(x, h / 2, z); p.castShadow = true; support.add(p);
  });
  const sol = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.3), M.beton); sol.position.y = 0.03; sol.receiveShadow = true; support.add(sol);
  // Soleil lumineux
  const soleil = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffc44d }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.25 }));
  const astre = new THREE.Group(); astre.add(soleil, halo); g.add(astre);
  g.userData.anime = (t) => {
    support.rotation.y = -0.5 + Math.sin(t * 0.25) * 0.35;
    const a = t * 0.35;
    astre.position.set(Math.cos(a) * 1.6, 2.55 + Math.sin(a * 2) * 0.12, -1.2 + Math.sin(a) * 0.4);
    halo.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08);
    g.userData.lumiere && g.userData.lumiere.position.copy(astre.position).multiplyScalar(2.2);
  };
  g.userData.camera = { pos: [2.7, 2.7, 4.0], cible: [0, 0.75, 0] };
  return g;
}

function eolienne(M) {
  const g = new THREE.Group();
  const sol = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.12, 48), M.beton); sol.position.y = 0.06; sol.receiveShadow = true; g.add(sol);
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 3.1, 32), M.blanc); mat.position.y = 1.6; mat.castShadow = true; g.add(mat);
  const tete = new THREE.Group(); tete.position.y = 3.15; g.add(tete);
  const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 8, 24), M.blanc); nacelle.rotation.x = Math.PI / 2; nacelle.position.z = -0.05; nacelle.castShadow = true; tete.add(nacelle);
  const rotor = new THREE.Group(); rotor.position.z = 0.36; tete.add(rotor);
  const moyeu = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), M.blanc); moyeu.scale.z = 1.5; rotor.add(moyeu);
  // Pale profilée (fine, effilée, légèrement vrillée)
  const forme = new THREE.Shape();
  forme.moveTo(0, -0.07); forme.bezierCurveTo(0.5, -0.12, 1.1, -0.06, 1.75, -0.015); forme.lineTo(1.75, 0.012);
  forme.bezierCurveTo(1.1, 0.03, 0.5, 0.05, 0, 0.06); forme.closePath();
  const geoPale = new THREE.ExtrudeGeometry(forme, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 24 });
  geoPale.translate(0.1, 0, -0.012);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(geoPale, M.blanc); p.rotation.z = (i * Math.PI * 2) / 3; p.rotation.x = 0.18; p.castShadow = true; rotor.add(p);
  }
  g.userData.anime = (t, dt) => {
    rotor.rotation.z -= dt * 2.4;                      // rotation continue des pales
    tete.rotation.y = Math.sin(t * 0.2) * 0.35;        // la nacelle suit le vent
  };
  g.userData.camera = { pos: [5.6, 2.4, 8.5], cible: [0, 2.0, 0] };
  return g;
}

const FABRIQUES = { tournevis, camera, panneau, eolienne };

// ---------- Scène ----------
function monter(el) {
  const fab = FABRIQUES[el.getAttribute("data-objet")]; if (!fab) return;
  el.setAttribute("data-pret", "1");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
  catch (e) { el.classList.add("iti-3d-sans-webgl"); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const M = materiaux();
  const objet = fab(M); scene.add(objet);

  const soleil = new THREE.DirectionalLight(0xffffff, 2.2);
  soleil.position.set(3, 6, 4); soleil.castShadow = true; soleil.shadow.mapSize.set(1024, 1024);
  Object.assign(soleil.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 }); soleil.shadow.bias = -0.0005;
  scene.add(soleil, new THREE.HemisphereLight(0xdfe9f5, 0x6b5a48, 0.6));
  objet.userData.lumiere = soleil;
  const ombre = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ombre.rotation.x = -Math.PI / 2; ombre.position.y = -0.33; ombre.receiveShadow = true; scene.add(ombre);

  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const c = objet.userData.camera; cam.position.set(...c.pos); cam.lookAt(...c.cible);

  function taille() {
    const w = el.clientWidth || 300, h = el.clientHeight || 240;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  taille(); new ResizeObserver(taille).observe(el);

  const horloge = new THREE.Clock(); let visible = true, t = 0;
  function image() {
    const dt = Math.min(horloge.getDelta(), 0.05);
    if (visible && !calme) { t += dt; objet.userData.anime(t, dt); }
    renderer.render(scene, cam);
  }
  objet.userData.anime(1.2, 0.016); image();
  if (calme) return;
  renderer.setAnimationLoop(image);
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    renderer.setAnimationLoop(visible ? image : null); horloge.getDelta();
  }, { rootMargin: "100px" }).observe(el);
}

function chercher() { document.querySelectorAll(".iti-3d-scene:not([data-pret])").forEach(monter); }
chercher();
new MutationObserver(chercher).observe(document.documentElement, { childList: true, subtree: true });
