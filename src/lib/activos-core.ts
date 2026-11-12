import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, bitacora, plantas, sectores, tiposMaquina } from "@/db/schema";
import { mismoNombre } from "./arbol";
import type { UsuarioSesion } from "./auth-core";
import { copiarPlantilla, tipoPorNombre } from "./sistemas-core";
import { ErrorDeNegocio } from "./usuarios-core";

function exigirGestion(actor: UsuarioSesion): void {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para gestionar activos.");
  }
}

function esDuplicado(e: unknown): boolean {
  const codigo = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
  return codigo === "23505";
}

function anio(valor: string | undefined, etiqueta: string): number | null {
  if (!valor?.trim()) return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) {
    throw new ErrorDeNegocio(`${etiqueta}: escribe un año de 4 dígitos.`);
  }
  return n;
}

export type DatosActivo = {
  codigo: string;
  nombre: string;
  plantaId: number;
  /** Tipo elegido de la lista (formulario). */
  tipoMaquinaId?: number | null;
  /** Tipo escrito por nombre (carga desde Excel): si no existe, se crea. */
  tipo?: string;
  fabricante?: string;
  modelo?: string;
  numeroSerie?: string;
  formato?: string;
  paisOrigen?: string;
  anioFabricacion?: string;
  anioLlegada?: string;
  anioInstalacion?: string;
  condicionLlegada?: string;
  seccion?: string;
  garantia?: string;
  codigoMetrics?: string;
  /** Sistemas propios de la máquina, además de la plantilla de su tipo: uno por línea o separados por coma. */
  sectores?: string;
};

const limpio = (v?: string) => v?.trim() || null;

const ESTADOS = ["OPERATIVA", "DETENIDA", "FUERA_DE_SERVICIO"] as const;
export type EstadoOperativo = (typeof ESTADOS)[number];

/** Campos comunes a la creación y a la edición, ya validados. */
function camposDeFicha(datos: DatosActivo) {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new ErrorDeNegocio("Falta el nombre de la máquina.");
  return {
    nombre,
    fabricante: limpio(datos.fabricante),
    modelo: limpio(datos.modelo),
    numeroSerie: limpio(datos.numeroSerie),
    formato: limpio(datos.formato),
    paisOrigen: limpio(datos.paisOrigen),
    anioFabricacion: anio(datos.anioFabricacion, "Año de fabricación"),
    anioLlegada: anio(datos.anioLlegada, "Año de llegada"),
    anioInstalacion: anio(datos.anioInstalacion, "Año de instalación"),
    condicionLlegada:
      datos.condicionLlegada === "NUEVA" ? ("NUEVA" as const) : datos.condicionLlegada === "USADA" ? ("USADA" as const) : null,
    seccion: limpio(datos.seccion),
    garantia: limpio(datos.garantia),
    codigoMetrics: limpio(datos.codigoMetrics),
  };
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** El tipo de máquina: el elegido de la lista o, en la carga desde Excel, el escrito por nombre. */
async function resolverTipo(tx: Tx, datos: Pick<DatosActivo, "tipo" | "tipoMaquinaId">): Promise<number | null> {
  if (datos.tipoMaquinaId != null && Number.isInteger(datos.tipoMaquinaId)) {
    const [tipo] = await tx.select({ id: tiposMaquina.id }).from(tiposMaquina).where(eq(tiposMaquina.id, datos.tipoMaquinaId));
    if (!tipo) throw new ErrorDeNegocio("El tipo de máquina elegido ya no existe.");
    return tipo.id;
  }
  if (datos.tipo?.trim()) return tipoPorNombre(tx, datos.tipo);
  return null;
}

/** Edita la ficha técnica y el estado operativo. El ID del activo no cambia. */
export async function actualizarActivo(
  db: DB,
  actor: UsuarioSesion,
  id: number,
  datos: Omit<DatosActivo, "codigo" | "sectores"> & { estadoOperativo: string },
): Promise<void> {
  exigirGestion(actor);
  if (!ESTADOS.includes(datos.estadoOperativo as EstadoOperativo)) {
    throw new ErrorDeNegocio("Elige el estado operativo.");
  }
  const campos = camposDeFicha({ ...datos, codigo: "" });
  try {
    await db.transaction(async (tx) => {
      const [planta] = await tx.select({ id: plantas.id }).from(plantas).where(eq(plantas.id, datos.plantaId));
      if (!planta) throw new ErrorDeNegocio("Elige la planta.");
      const tipoMaquinaId = await resolverTipo(tx, datos);
      const cambiados = await tx
        .update(activos)
        .set({ ...campos, tipoMaquinaId, plantaId: planta.id, estadoOperativo: datos.estadoOperativo as EstadoOperativo })
        .where(eq(activos.id, id))
        .returning({ id: activos.id });
      if (cambiados.length === 0) throw new ErrorDeNegocio("El activo no existe.");
      // Una máquina sin árbol recibe la plantilla del tipo recién elegido. Si ya tiene árbol,
      // no se toca: la plantilla se aplica a pedido desde la ficha.
      if (tipoMaquinaId !== null) {
        const [uno] = await tx.select({ id: sectores.id }).from(sectores).where(eq(sectores.activoId, id)).limit(1);
        if (!uno) await copiarPlantilla(tx, id);
      }
      await tx.insert(bitacora).values({
        usuarioId: actor.id,
        accion: "EDITAR_ACTIVO",
        entidad: "activo",
        entidadId: String(id),
        detalle: { ...campos, tipoMaquinaId, estadoOperativo: datos.estadoOperativo },
      });
    });
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorDeNegocio("Ya existe otro activo con ese código de Metrics.");
    throw e;
  }
}

export async function crearActivo(db: DB, actor: UsuarioSesion, datos: DatosActivo): Promise<number> {
  exigirGestion(actor);
  const codigo = datos.codigo.trim().toUpperCase();
  if (!codigo) throw new ErrorDeNegocio("Falta el ID del activo.");
  const campos = camposDeFicha(datos);
  const nombresSector = [...new Set((datos.sectores ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
  try {
    return await db.transaction(async (tx) => {
      const [planta] = await tx.select({ id: plantas.id }).from(plantas).where(eq(plantas.id, datos.plantaId));
      if (!planta) throw new ErrorDeNegocio("Elige la planta.");
      const tipoMaquinaId = await resolverTipo(tx, datos);
      const [nuevo] = await tx
        .insert(activos)
        .values({ ...campos, tipoMaquinaId, codigo, plantaId: planta.id })
        .returning({ id: activos.id });
      // Primero la plantilla del tipo; después, los sistemas propios que no estén ya en ella.
      if (tipoMaquinaId !== null) await copiarPlantilla(tx, nuevo.id);
      const raices = await tx.select({ nombre: sectores.nombre, padreId: sectores.padreId }).from(sectores).where(eq(sectores.activoId, nuevo.id));
      const faltan = nombresSector.filter((n) => !raices.some((r) => r.padreId === null && mismoNombre(r.nombre, n)));
      if (faltan.length) {
        await tx.insert(sectores).values(faltan.map((n) => ({ activoId: nuevo.id, nombre: n })));
      }
      await tx.insert(bitacora).values({
        usuarioId: actor.id,
        accion: "CREAR_ACTIVO",
        entidad: "activo",
        entidadId: String(nuevo.id),
        detalle: { codigo },
      });
      return nuevo.id;
    });
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorDeNegocio("Ya existe un activo con ese ID o con ese código de Metrics.");
    throw e;
  }
}
