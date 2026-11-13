"use server";

import { db } from "@/db";
import { ejecutar, entero, texto } from "@/lib/accion";
import { fijarProximoFolioOc } from "@/lib/compras-core";
import { exigirSesion } from "@/lib/dal";
import { agregarFeriado, guardarHorario, quitarFeriado } from "@/lib/horarios-core";

export async function accionGuardarHorario(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/configuracion", async () => {
    await guardarHorario(db, actor, entero(formData.get("usuarioId")), {
      dias: formData.getAll("dia").map((d) => Number(d)),
      entrada: texto(formData.get("entrada")),
      salida: texto(formData.get("salida")),
    });
  });
}

export async function accionAgregarFeriado(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/configuracion", async () => {
    await agregarFeriado(db, actor, texto(formData.get("fecha")), texto(formData.get("nombre")));
  });
}

export async function accionQuitarFeriado(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/configuracion", async () => {
    await quitarFeriado(db, actor, texto(formData.get("fecha")));
  });
}

export async function accionFijarFolioOc(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/configuracion", async () => {
    const limpio = texto(formData.get("folio")).trim().replace(/\./g, "");
    await fijarProximoFolioOc(db, actor, /^\d+$/.test(limpio) ? Number(limpio) : NaN);
  });
}
