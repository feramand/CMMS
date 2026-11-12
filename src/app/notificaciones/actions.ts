"use server";

import { db } from "@/db";
import { exigirSesion } from "@/lib/dal";
import { guardarSuscripcion, quitarSuscripcion, type Suscripcion } from "@/lib/push-core";
import { ErrorDeNegocio } from "@/lib/usuarios-core";

export async function accionGuardarSuscripcion(s: Suscripcion): Promise<{ ok: boolean; error?: string }> {
  const actor = await exigirSesion();
  try {
    await guardarSuscripcion(db, actor, {
      endpoint: String(s?.endpoint ?? ""),
      p256dh: String(s?.p256dh ?? ""),
      auth: String(s?.auth ?? ""),
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof ErrorDeNegocio) return { ok: false, error: e.message };
    throw e;
  }
}

export async function accionQuitarSuscripcion(endpoint: string): Promise<void> {
  await exigirSesion();
  await quitarSuscripcion(db, String(endpoint));
}
