import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mode normal : l'interface appelle le serveur (/api). En développement, Vite relaie /api vers le serveur local.
// Mode « demo » : un serveur simulé dans le navigateur, avec des données fictives, pour valider l'ergonomie
// sans installer PostgreSQL. Ce mode n'offre AUCUNE sécurité et n'est jamais utilisé en production.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __DEMO__: JSON.stringify(mode === "demo") },
  build: {
    outDir: mode === "demo" ? "dist-demo" : "dist",
    sourcemap: false,
    // La démo doit tenir dans un seul fichier : pas de morceau chargé à part.
    rollupOptions: mode === "demo" ? { output: { inlineDynamicImports: true } } : {},
  },
  server: { proxy: { "/api": { target: process.env.GC_API ?? "http://localhost:8443", changeOrigin: false } } },
}));
