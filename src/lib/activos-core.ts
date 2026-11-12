import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, bitacora, plantas, sectores } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
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
  /** Sectores o componentes, uno por línea o separados por coma. */
  sectores?: string;
};

const limpio = (v?: string) => v?.trim() || null;

export async function crearActivo(db: DB, actor: UsuarioSesion, datos: DatosActivo): Promise<number> {
  exigirGestion(actor);
  const codigo = datos.codigo.trim().toUpperCase();
  const nombre = datos.nombre.trim();
  if (!codigo) throw new ErrorDeNegocio("Falta el ID del activo.");
  if (!nombre) throw new ErrorDeNegocio("Falta el nombre de la máquina.");
  const condicion = datos.condicionLlegada === "NUEVA" || datos.condicionLlegada === "USADA" ? datos.condicionLlegada : null;
  const nombresSector = [...new Set((datos.sectores ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
  try {
    return await db.transaction(async (tx) => {
      const [planta] = await tx.select({ id: plantas.id }).from(plantas).where(eq(plantas.id, datos.plantaId));
      if (!planta) throw new ErrorDeNegocio("Elige la planta.");
      const [nuevo] = await tx
        .insert(activos)
        .values({
          codigo,
          nombre,
          plantaId: planta.id,
          tipo: limpio(datos.tipo),
          fabricante: limpio(datos.fabricante),
          modelo: limpio(datos.modelo),
          numeroSerie: limpio(datos.numeroSerie),
          formato: limpio(datos.formato),
          paisOrigen: limpio(datos.paisOrigen),
          anioFabricacion: anio(datos.anioFabricacion, "Año de fabricación"),
          anioLlegada: anio(datos.anioLlegada, "Año de llegada"),
          anioInstalacion: anio(datos.anioInstalacion, "Año de instalación"),
          condicionLlegada: condicion,
          seccion: limpio(datos.seccion),
          garantia: limpio(datos.garantia),
          codigoMetrics: limpio(datos.codigoMetrics),
        })
        .returning({ id: activos.id });
      if (nombresSector.length) {
        await tx.insert(sectores).values(nombresSector.map((n) => ({ activoId: nuevo.id, nombre: n })));
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

export async function agregarSector(db: DB, actor: UsuarioSesion, activoId: number, nombre: string): Promise<void> {
  exigirGestion(actor);
  const limpioNombre = nombre.trim();
  if (!limpioNombre) throw new ErrorDeNegocio("Escribe el nombre del sector.");
  try {
    await db.insert(sectores).values({ activoId, nombre: limpioNombre });
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorDeNegocio("Ese sector ya existe en esta máquina.");
    throw e;
  }
}
