import "server-only";
import { db } from "@/db";
import { evaluarPautas } from "./pautas-core";
import { despacharPendientes } from "./push";

let enCurso = false;

/** Una pasada del reloj: libera o da por incumplidas las pautas que correspondan y envía sus avisos. */
export async function revisarPautas(): Promise<void> {
  if (enCurso) return;
  enCurso = true;
  try {
    const cambios = await evaluarPautas(db);
    if (cambios > 0) await despacharPendientes();
  } catch (e) {
    console.error("No se pudieron revisar las pautas:", e);
  } finally {
    enCurso = false;
  }
}
