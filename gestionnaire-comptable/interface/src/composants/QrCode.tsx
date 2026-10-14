import { useMemo } from "react";
import QR from "qrcode";

/** QR code dessiné en SVG (pas d'image externe, compatible avec la politique de sécurité du serveur). */
export function QrCode({ texte, titre }: { texte: string; titre: string }) {
  const { taille, carres } = useMemo(() => {
    const q = QR.create(texte, { errorCorrectionLevel: "M" });
    const n = q.modules.size, c: string[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) c.push(`M${x} ${y}h1v1h-1z`);
    return { taille: n, carres: c.join("") };
  }, [texte]);
  return (
    <svg className="qr" viewBox={`-2 -2 ${taille + 4} ${taille + 4}`} role="img" aria-label={titre} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={taille + 4} height={taille + 4} fill="#fff" />
      <path d={carres} fill="#10243a" />
    </svg>
  );
}
