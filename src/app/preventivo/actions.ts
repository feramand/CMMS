"use server";

import { db } from "@/db";
import { ejecutar, entero, texto } from "@/lib/accion";
import { exigirSesion } from "@/lib/dal";
import { desactivarCodigo, guardarCodigo } from "@/lib/metrics-core";
import {
  actualizarPauta,
  agregarActividad,
  crearOtDesdePauta,
  crearPauta,
  finalizarCiclo,
  guardarPorcentajes,
  liberarAnticipada,
  marcarActividad,
  quitarActividad,
  registrarLecturaManual,
} from "@/lib/pautas-core";

/** Número entero escrito con o sin puntos de miles; vacío = null. */
function numero(valor: FormDataEntryValue | null): number | null {
  const limpio = texto(valor).trim().replace(/\./g, "");
  if (!limpio) return null;
  return /^\d+$/.test(limpio) ? Number(limpio) : NaN;
}

export async function accionCrearPauta(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/preventivo", async () => {
    const id = await crearPauta(db, actor, {
      activoId: entero(formData.get("activoId")),
      nombre: texto(formData.get("nombre")),
      tipo: texto(formData.get("tipo")),
      intervalo: numero(formData.get("intervalo")) ?? NaN,
      especialidadId: entero(formData.get("especialidadId")),
      actividades: texto(formData.get("actividades")),
      baseGiros: numero(formData.get("baseGiros")),
      baseFecha: texto(formData.get("baseFecha")) || null,
    });
    return `/admin/preventivo/${id}`;
  });
}

export async function accionActualizarPauta(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/admin/preventivo/${id}`, () =>
    actualizarPauta(db, actor, id, {
      nombre: texto(formData.get("nombre")),
      intervalo: numero(formData.get("intervalo")) ?? NaN,
      especialidadId: entero(formData.get("especialidadId")),
      pctLiberacion: numero(formData.get("pctLiberacion")),
      pctLimite: numero(formData.get("pctLimite")),
      activa: formData.get("activa") === "si",
      incluyeInferiores: formData.get("incluyeInferiores") !== "no",
    }),
  );
}

export async function accionAgregarActividad(formData: FormData) {
  const actor = await exigirSesion();
  const pautaId = entero(formData.get("pautaId"));
  await ejecutar(`/admin/preventivo/${pautaId}`, () =>
    agregarActividad(db, actor, pautaId, texto(formData.get("descripcion")), texto(formData.get("grupo")), texto(formData.get("variante"))),
  );
}

export async function accionQuitarActividad(formData: FormData) {
  const actor = await exigirSesion();
  const pautaId = entero(formData.get("pautaId"));
  await ejecutar(`/admin/preventivo/${pautaId}`, () => quitarActividad(db, actor, entero(formData.get("id"))));
}

export async function accionLiberar(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar(texto(formData.get("origen")) === "detalle" ? `/admin/preventivo/${entero(formData.get("pautaId"))}` : "/admin/preventivo", () =>
    liberarAnticipada(db, actor, entero(formData.get("cicloId"))),
  );
}

export async function accionGuardarPorcentajes(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/preventivo", () =>
    guardarPorcentajes(db, actor, {
      liberacion: numero(formData.get("liberacion")) ?? NaN,
      limite: numero(formData.get("limite")) ?? NaN,
    }),
  );
}

export async function accionRegistrarLectura(formData: FormData) {
  const actor = await exigirSesion();
  const activoId = entero(formData.get("activoId"));
  await ejecutar(`/admin/activos/${activoId}`, () => registrarLecturaManual(db, actor, activoId, numero(formData.get("giros")) ?? NaN));
}

export async function accionMarcarActividad(formData: FormData) {
  const actor = await exigirSesion();
  const cicloId = entero(formData.get("cicloId"));
  const estado = texto(formData.get("estado"));
  // Vuelve a la misma cartilla conservando los filtros elegidos.
  const vuelta = texto(formData.get("vuelta"));
  await ejecutar(vuelta.startsWith(`/pauta/${cicloId}`) ? vuelta : `/pauta/${cicloId}`, () =>
    marcarActividad(
      db,
      actor,
      entero(formData.get("id")),
      estado === "HECHA" || estado === "NO_REALIZADA" ? estado : "PENDIENTE",
      texto(formData.get("nota")),
      undefined,
      texto(formData.get("motivo")),
    ),
  );
}

export async function accionFinalizarPauta(formData: FormData) {
  const actor = await exigirSesion();
  const cicloId = entero(formData.get("cicloId"));
  await ejecutar(`/pauta/${cicloId}`, async () => {
    await finalizarCiclo(db, actor, cicloId, {
      giros: numero(formData.get("giros")),
      observaciones: texto(formData.get("observaciones")),
    });
    return `/pauta/${cicloId}?aviso=finalizada`;
  });
}

export async function accionOtDesdePauta(formData: FormData) {
  const actor = await exigirSesion();
  const cicloId = entero(formData.get("cicloId"));
  await ejecutar(`/pauta/${cicloId}`, async () => {
    await crearOtDesdePauta(db, actor, cicloId, { descripcion: texto(formData.get("descripcion")), prioridad: texto(formData.get("prioridad")) });
    return `/pauta/${cicloId}?aviso=ot`;
  });
}

export async function accionGuardarCodigo(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/metrics", () =>
    guardarCodigo(db, actor, {
      codigo: texto(formData.get("codigo")),
      descripcion: texto(formData.get("descripcion")),
      categoria: texto(formData.get("categoria")),
    }),
  );
}

export async function accionDesactivarCodigo(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/metrics", () => desactivarCodigo(db, actor, texto(formData.get("codigo"))));
}
