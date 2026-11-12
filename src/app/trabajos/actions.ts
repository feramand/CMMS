"use server";

import { db } from "@/db";
import {
  categoriaEnum,
  estadoOtEnum,
  prioridadEnum,
  tipoOtEnum,
  type Categoria,
  type EstadoOt,
  type Prioridad,
  type TipoOt,
} from "@/db/schema";
import { ejecutar, entero, texto } from "@/lib/accion";
import { fotosDeFormulario, guardarFotos } from "@/lib/adjuntos-core";
import { exigirSesion } from "@/lib/dal";
import {
  asignarOt,
  cambiarEstadoOt,
  crearOt,
  guardarCausaRaiz,
  resolverRepuesto,
  solicitarRepuesto,
} from "@/lib/ot-core";
import { puedeEntrarAdmin } from "@/lib/perfiles";
import {
  asignarSolicitud,
  cerrarSolicitud,
  crearSolicitud,
  escalarSolicitud,
  tomarSolicitud,
} from "@/lib/sat-core";
import { ErrorDeNegocio } from "@/lib/usuarios-core";

function apoyos(formData: FormData): number[] {
  return formData
    .getAll("apoyo")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export async function accionReportar(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/reportar", async () => {
    const categoria = texto(formData.get("categoria")) as Categoria;
    if (!categoriaEnum.enumValues.includes(categoria)) throw new ErrorDeNegocio("Elige el tipo de falla.");
    const fotos = await fotosDeFormulario(formData);
    const r = await crearSolicitud(db, actor, {
      activoId: entero(formData.get("activoId")),
      categoria,
      comentario: texto(formData.get("comentario")),
      maquinaDetenida: formData.get("maquinaDetenida") !== "no",
    });
    await guardarFotos(db, actor, { solicitudId: r.id }, fotos);
    return `/sat/${r.id}${r.duplicada ? "?aviso=duplicada" : ""}`;
  });
}

export async function accionTomar(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(texto(formData.get("origen")) || `/sat/${id}`, async () => {
    await tomarSolicitud(db, actor, id);
    return `/sat/${id}`;
  });
}

export async function accionAsignarSolicitud(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/admin/solicitudes?sel=${id}`, async () => {
    await asignarSolicitud(db, actor, id, entero(formData.get("tecnicoId")));
    return "/admin/solicitudes";
  });
}

export async function accionCerrar(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/sat/${id}`, async () => {
    const origenReal = texto(formData.get("origenReal"));
    const fotos = await fotosDeFormulario(formData);
    await cerrarSolicitud(db, actor, id, {
      sectorId: entero(formData.get("sectorId")),
      solucion: texto(formData.get("solucion")),
      origenReal: origenReal ? (origenReal as Categoria) : null,
      apoyoIds: apoyos(formData),
    });
    await guardarFotos(db, actor, { solicitudId: id }, fotos);
  });
}

export async function accionEscalar(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/sat/${id}`, async () => {
    const prioridad = texto(formData.get("prioridad")) as Prioridad;
    const r = await escalarSolicitud(db, actor, id, {
      descripcion: texto(formData.get("descripcion")),
      prioridad: prioridadEnum.enumValues.includes(prioridad) ? prioridad : "MEDIA",
    });
    return `/ot/${r.otId}`;
  });
}

export async function accionCrearOt(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/admin/ot", async () => {
    const tipo = texto(formData.get("tipo")) as TipoOt;
    const prioridad = texto(formData.get("prioridad")) as Prioridad;
    if (!tipoOtEnum.enumValues.includes(tipo) || !prioridadEnum.enumValues.includes(prioridad)) {
      throw new ErrorDeNegocio("Elige el tipo y la prioridad.");
    }
    const r = await crearOt(db, actor, {
      activoId: entero(formData.get("activoId")),
      tipo,
      descripcion: texto(formData.get("descripcion")),
      especialidadId: entero(formData.get("especialidadId")),
      prioridad,
      responsableId: entero(formData.get("responsableId")) || null,
      proveedorExterno: texto(formData.get("proveedorExterno")),
      fechaProgramada: texto(formData.get("fechaProgramada")) || null,
    });
    return `/ot/${r.id}`;
  });
}

export async function accionAsignarOt(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/ot/${id}`, async () => {
    await asignarOt(db, actor, id, {
      responsableId: entero(formData.get("responsableId")),
      fechaProgramada: texto(formData.get("fechaProgramada")) || null,
    });
  });
}

export async function accionEstadoOt(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/ot/${id}`, async () => {
    const estado = texto(formData.get("estado")) as EstadoOt;
    if (!estadoOtEnum.enumValues.includes(estado)) throw new ErrorDeNegocio("Elige un estado.");
    await cambiarEstadoOt(db, actor, id, estado, {
      apoyoIds: apoyos(formData),
      observaciones: texto(formData.get("observaciones")),
    });
  });
}

export async function accionCausaRaiz(formData: FormData) {
  const actor = await exigirSesion();
  const id = entero(formData.get("id"));
  await ejecutar(`/ot/${id}`, async () => {
    await guardarCausaRaiz(db, actor, id, {
      causa: texto(formData.get("causa")),
      solucion: texto(formData.get("solucion")),
      acciones: texto(formData.get("acciones")),
      observaciones: texto(formData.get("observaciones")),
    });
  });
}

export async function accionSolicitarRepuesto(formData: FormData) {
  const actor = await exigirSesion();
  const solicitudId = entero(formData.get("solicitudId")) || null;
  const otId = entero(formData.get("otId")) || null;
  const cicloId = entero(formData.get("cicloId")) || null;
  const vuelta = otId ? `/ot/${otId}` : solicitudId ? `/sat/${solicitudId}` : `/pauta/${cicloId}`;
  await ejecutar(`/repuesto?${otId ? `ot=${otId}` : solicitudId ? `sat=${solicitudId}` : `pauta=${cicloId}`}`, async () => {
    const fotos = await fotosDeFormulario(formData);
    const repuestoId = await solicitarRepuesto(db, actor, {
      solicitudId,
      otId,
      cicloId,
      cantidad: Number(formData.get("cantidad")),
      codigoFabricante: texto(formData.get("codigoFabricante")),
      descripcion: texto(formData.get("descripcion")),
    });
    await guardarFotos(db, actor, { repuestoId }, fotos);
    return `${vuelta}?aviso=repuesto`;
  });
}

export async function accionResolverRepuesto(formData: FormData) {
  const actor = await exigirSesion();
  await ejecutar(puedeEntrarAdmin(actor.perfil) ? "/admin" : "/inicio", async () => {
    await resolverRepuesto(
      db,
      actor,
      entero(formData.get("id")),
      formData.get("estado") === "RECHAZADA" ? "RECHAZADA" : "ENTREGADA",
    );
  });
}
