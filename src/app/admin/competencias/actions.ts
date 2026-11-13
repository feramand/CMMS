"use server";

import { db } from "@/db";
import { ejecutar, entero } from "@/lib/accion";
import { guardarCompetencias } from "@/lib/competencias-core";
import { exigirSesion } from "@/lib/dal";

export async function accionGuardarCompetencias(formData: FormData) {
  const actor = await exigirSesion();
  const usuarioId = entero(formData.get("usuarioId"));
  await ejecutar(`/admin/competencias?tecnico=${usuarioId}`, async () => {
    const niveles: Record<number, string> = {};
    for (const [clave, valor] of formData.entries()) {
      if (clave.startsWith("nivel-") && typeof valor === "string") niveles[Number(clave.slice(6))] = valor;
    }
    await guardarCompetencias(db, actor, usuarioId, niveles);
  });
}
