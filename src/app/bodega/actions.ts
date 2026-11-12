"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import type { EstadoCarga } from "@/app/admin/carga/actions";
import { db } from "@/db";
import { ordenesTrabajo, repuestos } from "@/db/schema";
import { ejecutar, entero, texto } from "@/lib/accion";
import {
  abrirToma,
  actualizarRepuesto,
  anularToma,
  cerrarToma,
  COLUMNAS_REPUESTOS,
  contar,
  crearRepuesto,
  entregarSolicitud,
  fijarUbicacion,
  importarRepuestos,
  numero,
  rechazarSolicitud,
  registrarAjuste,
  registrarDevolucion,
  registrarEntrada,
  registrarSalida,
  registrarTraslado,
  type DatosRepuesto,
} from "@/lib/bodega-core";
import { ErrorDeCarga } from "@/lib/carga-core";
import { exigirSesion } from "@/lib/dal";
import { leerPlanilla } from "@/lib/excel";
import { ErrorDeNegocio } from "@/lib/usuarios-core";

/** Número de un formulario. Vacío o no numérico se devuelve como NaN para que la regla lo rechace. */
function num(valor: FormDataEntryValue | null): number {
  return numero(texto(valor)) ?? NaN;
}

function opcional(valor: FormDataEntryValue | null, que: string): number | null {
  const n = numero(texto(valor));
  if (Number.isNaN(n)) throw new ErrorDeNegocio(`${que} debe ser un número.`);
  return n;
}

/** Busca un repuesto por el código escrito o elegido de las sugerencias ("ROD-6204 — Rodamiento"). */
async function repuestoPorCodigo(valor: FormDataEntryValue | null): Promise<number> {
  const codigo = texto(valor).split(" — ")[0].trim().toUpperCase();
  if (!codigo) throw new ErrorDeNegocio("Indica el código del repuesto.");
  const [r] = await db.select({ id: repuestos.id }).from(repuestos).where(eq(repuestos.codigo, codigo));
  if (!r) throw new ErrorDeNegocio(`No existe un repuesto con el código ${codigo}.`);
  return r.id;
}

/** OT escrita por su folio (opcional). */
async function otPorFolio(valor: FormDataEntryValue | null): Promise<number | null> {
  const folio = texto(valor).trim();
  if (!folio) return null;
  const [ot] = await db.select({ id: ordenesTrabajo.id }).from(ordenesTrabajo).where(eq(ordenesTrabajo.folio, folio));
  if (!ot) throw new ErrorDeNegocio(`No existe la orden de trabajo ${folio}.`);
  return ot.id;
}

function datosRepuesto(f: FormData): DatosRepuesto {
  return {
    codigo: texto(f.get("codigo")),
    descripcion: texto(f.get("descripcion")),
    codigoFabricante: texto(f.get("codigoFabricante")),
    marca: texto(f.get("marca")),
    cuentaId: entero(f.get("cuentaId")) || null,
    unidad: texto(f.get("unidad")),
    familia: texto(f.get("familia")),
    stockMinimo: opcional(f.get("stockMinimo"), "El stock mínimo"),
    stockMaximo: opcional(f.get("stockMaximo"), "El stock máximo"),
    activoIds: f.getAll("activoIds").map((v) => Number(v)),
  };
}

export async function accionCrearRepuesto(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/bodega/nuevo", async () => `/bodega/repuesto/${await crearRepuesto(db, actor, datosRepuesto(f))}`);
}

export async function accionEditarRepuesto(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/bodega/repuesto/${id}`, async () => {
    await actualizarRepuesto(db, actor, id, { ...datosRepuesto(f), activo: f.get("activo") !== "no" });
  });
}

export async function accionMovimiento(f: FormData) {
  const actor = await exigirSesion();
  const repuestoId = entero(f.get("repuestoId"));
  const almacenId = entero(f.get("almacenId"));
  const tipo = texto(f.get("tipo"));
  await ejecutar(`/bodega/repuesto/${repuestoId}`, async () => {
    if (tipo === "ENTRADA") {
      await registrarEntrada(db, actor, {
        repuestoId,
        almacenId,
        cantidad: num(f.get("cantidad")),
        costoUnitario: opcional(f.get("costo"), "El costo"),
        documento: texto(f.get("documento")),
        nota: texto(f.get("nota")),
      });
    } else if (tipo === "SALIDA") {
      await registrarSalida(db, actor, {
        repuestoId,
        almacenId,
        cantidad: num(f.get("cantidad")),
        otId: await otPorFolio(f.get("folio")),
        recibeId: entero(f.get("recibeId")) || null,
        nota: texto(f.get("nota")),
      });
    } else if (tipo === "DEVOLUCION") {
      await registrarDevolucion(db, actor, {
        repuestoId,
        almacenId,
        cantidad: num(f.get("cantidad")),
        otId: await otPorFolio(f.get("folio")),
        nota: texto(f.get("nota")),
      });
    } else if (tipo === "TRASLADO") {
      await registrarTraslado(db, actor, {
        repuestoId,
        origenId: almacenId,
        destinoId: entero(f.get("destinoId")),
        cantidad: num(f.get("cantidad")),
        nota: texto(f.get("nota")),
      });
    } else if (tipo === "AJUSTE") {
      await registrarAjuste(db, actor, { repuestoId, almacenId, cantidadReal: num(f.get("cantidad")), nota: texto(f.get("nota")) });
    } else if (tipo === "UBICACION") {
      await fijarUbicacion(db, actor, repuestoId, almacenId, texto(f.get("ubicacion")));
    } else {
      throw new ErrorDeNegocio("Movimiento no reconocido.");
    }
    return `/bodega/repuesto/${repuestoId}?aviso=ok`;
  });
}

export async function accionEntregarSolicitud(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/bodega/solicitud/${id}`, async () => {
    await entregarSolicitud(db, actor, id, {
      repuestoId: await repuestoPorCodigo(f.get("repuesto")),
      almacenId: entero(f.get("almacenId")),
      cantidad: num(f.get("cantidad")),
    });
    return actor.perfil === "BODEGUERO" ? "/inicio" : "/bodega/solicitudes";
  });
}

export async function accionRechazarSolicitud(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/bodega/solicitud/${id}`, async () => {
    await rechazarSolicitud(db, actor, id, texto(f.get("motivo")));
    return actor.perfil === "BODEGUERO" ? "/inicio" : "/bodega/solicitudes";
  });
}

export async function accionAbrirToma(f: FormData) {
  const actor = await exigirSesion();
  await ejecutar("/bodega/inventarios", async () => `/bodega/inventarios/${await abrirToma(db, actor, entero(f.get("almacenId")))}`);
}

/** Guarda todos los conteos escritos en la pantalla y, si se pidió, agrega un repuesto que no estaba en la lista. */
export async function accionGuardarConteo(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/bodega/inventarios/${id}`, async () => {
    for (const [clave, valor] of f.entries()) {
      if (!clave.startsWith("c_")) continue;
      const n = numero(texto(valor));
      if (Number.isNaN(n)) throw new ErrorDeNegocio(`"${texto(valor)}" no es un número.`);
      await contar(db, actor, id, Number(clave.slice(2)), n);
    }
    if (texto(f.get("repuesto")).trim()) {
      await contar(db, actor, id, await repuestoPorCodigo(f.get("repuesto")), num(f.get("contadaNueva")));
    }
    if (f.get("cerrar") === "si") {
      const r = await cerrarToma(db, actor, id);
      return `/bodega/inventarios/${id}?aviso=${r.ajustes}`;
    }
    return `/bodega/inventarios/${id}?aviso=guardado`;
  });
}

export async function accionAnularToma(f: FormData) {
  const actor = await exigirSesion();
  const id = entero(f.get("id"));
  await ejecutar(`/bodega/inventarios/${id}`, async () => {
    await anularToma(db, actor, id);
    return "/bodega/inventarios";
  });
}

const MAX_BYTES = 5 * 1024 * 1024;

export async function accionCargarRepuestos(_estado: EstadoCarga, formData: FormData): Promise<EstadoCarga> {
  const actor = await exigirSesion();
  try {
    const f = formData.get("planilla");
    if (!(f instanceof File) || f.size === 0) throw new ErrorDeNegocio("Elige el archivo de la planilla.");
    if (f.size > MAX_BYTES) throw new ErrorDeNegocio("La planilla pesa más de 5 MB.");
    const n = await importarRepuestos(db, actor, await leerPlanilla(await f.arrayBuffer(), COLUMNAS_REPUESTOS));
    revalidatePath("/", "layout");
    return { ok: n === 1 ? "Se cargó 1 fila." : `Se cargaron ${n} filas.` };
  } catch (e) {
    if (e instanceof ErrorDeCarga) return { error: e.message, errores: e.errores };
    if (e instanceof ErrorDeNegocio) return { error: e.message };
    throw e;
  }
}
