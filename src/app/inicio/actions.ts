"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exigirPerfil } from "@/lib/dal";
import { marcarTurno } from "@/lib/usuarios-core";

export async function cambiarTurno(formData: FormData): Promise<void> {
  const usuario = await exigirPerfil("TECNICO");
  await marcarTurno(db, usuario, formData.get("enTurno") === "1");
  revalidatePath("/inicio");
}
