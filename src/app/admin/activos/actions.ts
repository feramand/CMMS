"use server";

import { db } from "@/db";
import { ejecutar, entero, texto } from "@/lib/accion";
import { agregarSector, crearActivo } from "@/lib/activos-core";
import { exigirSesion } from "@/lib/dal";

export async function accionCrearActivo(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/activos", async () => {
    const t = (n: string) => texto(formData.get(n));
    const id = await crearActivo(db, actor, {
      codigo: t("codigo"),
      nombre: t("nombre"),
      plantaId: entero(formData.get("plantaId")),
      tipo: t("tipo"),
      fabricante: t("fabricante"),
      modelo: t("modelo"),
      numeroSerie: t("numeroSerie"),
      formato: t("formato"),
      paisOrigen: t("paisOrigen"),
      anioFabricacion: t("anioFabricacion"),
      anioLlegada: t("anioLlegada"),
      anioInstalacion: t("anioInstalacion"),
      condicionLlegada: t("condicionLlegada"),
      seccion: t("seccion"),
      garantia: t("garantia"),
      codigoMetrics: t("codigoMetrics"),
      sectores: t("sectores"),
    });
    return `/admin/activos/${id}`;
  });
}

export async function accionAgregarSector(formData: FormData) {
  const actor = await exigirSesion();
  const activoId = entero(formData.get("activoId"));
  await ejecutar(`/admin/activos/${activoId}`, async () => {
    await agregarSector(db, actor, activoId, texto(formData.get("nombre")));
  });
}
