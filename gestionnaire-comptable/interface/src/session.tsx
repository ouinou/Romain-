import { createContext, useContext } from "react";
import type { Moi } from "./types";

export interface Session {
  moi: Moi;
  a: (permission: string) => boolean;
  rafraichir: () => Promise<void>;
  deconnecter: () => Promise<void>;
}

export const SessionCtx = createContext<Session | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("Session absente");
  return s;
}
