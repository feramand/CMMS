// Carga inicial desde planillas: activos, usuarios y plan de mantenimiento. Todo o nada: si una fila falla, no se carga ninguna.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, especialidades, pautas, plantas, type Modalidad, type Perfil } from "@/db/schema";
import { crearActivo } from "./activos-core";
import type { UsuarioSesion } from "./auth-core";
import { crearPauta, grupoPorNombre } from "./pautas-core";
import { crearUsuario, ErrorDeNegocio } from "./usuarios-core";

export type Columna = { clave: string; titulo: string; obligatoria?: boolean; ejemplo: string };

export const COLUMNAS_ACTIVOS: Columna[] = [
  { clave: "codigo", titulo: "ID del activo", obligatoria: true, ejemplo: "IMP-001" },
  { clave: "nombre", titulo: "Nombre de la máquina", obligatoria: true, ejemplo: "Heidelberg XL106" },
  { clave: "planta", titulo: "Planta", obligatoria: true, ejemplo: "Planta 1" },
  { clave: "tipo", titulo: "Tipo de máquina", ejemplo: "Prensa Offset Plana" },
  { clave: "fabricante", titulo: "Fabricante", ejemplo: "Heidelberg" },
  { clave: "modelo", titulo: "Modelo", ejemplo: "Speedmaster XL 106" },
  { clave: "numeroSerie", titulo: "Número de serie", ejemplo: "" },
  { clave: "formato", titulo: "Formato de trabajo", ejemplo: "" },
  { clave: "paisOrigen", titulo: "País de origen", ejemplo: "Alemania" },
  { clave: "anioFabricacion", titulo: "Año de fabricación", ejemplo: "2015" },
  { clave: "anioLlegada", titulo: "Año de llegada", ejemplo: "2016" },
  { clave: "anioInstalacion", titulo: "Año de instalación", ejemplo: "2016" },
  { clave: "condicionLlegada", titulo: "Condición de llegada (Nueva o Usada)", ejemplo: "Nueva" },
  { clave: "seccion", titulo: "Ubicación o sección", ejemplo: "Offset" },
  { clave: "garantia", titulo: "Garantía", ejemplo: "" },
  { clave: "codigoMetrics", titulo: "Código en Metrics", ejemplo: "" },
  { clave: "unidadContador", titulo: "Qué cuenta el contador (giros, libros…)", ejemplo: "giros" },
  { clave: "sectores", titulo: "Sistemas propios (separados por coma)", ejemplo: "Marcador, Cuerpo impresor 1, Salida" },
];

export const COLUMNAS_USUARIOS: Columna[] = [
  { clave: "nombre", titulo: "Nombre", obligatoria: true, ejemplo: "Juan Pérez" },
  { clave: "perfil", titulo: "Perfil", obligatoria: true, ejemplo: "Técnico" },
  { clave: "identificador", titulo: "RUT o usuario de Metrics", obligatoria: true, ejemplo: "12.345.678-5" },
  { clave: "clave", titulo: "PIN o contraseña inicial", obligatoria: true, ejemplo: "1234" },
  { clave: "email", titulo: "Correo (opcional)", ejemplo: "" },
  { clave: "especialidad", titulo: "Especialidad (solo técnicos)", ejemplo: "Mecánica" },
  { clave: "modalidad", titulo: "Modalidad (Turnos u Horario fijo)", ejemplo: "Turnos" },
];

// Una fila por actividad. Las filas con la misma máquina y la misma cartilla forman una sola cartilla.
export const COLUMNAS_PAUTAS: Columna[] = [
  { clave: "codigo", titulo: "ID del activo", obligatoria: true, ejemplo: "IMP-001" },
  { clave: "pauta", titulo: "Nombre de la cartilla", obligatoria: true, ejemplo: "Cartilla 500.000" },
  { clave: "tipo", titulo: "Se mide por (Tiempo o Giros)", obligatoria: true, ejemplo: "Giros" },
  { clave: "intervalo", titulo: "Intervalo (días o giros)", obligatoria: true, ejemplo: "500000" },
  { clave: "especialidad", titulo: "Especialidad responsable", obligatoria: true, ejemplo: "Mecánica" },
  { clave: "grupo", titulo: "Quién hace la actividad (Operador o una especialidad)", ejemplo: "Operador" },
  { clave: "actividad", titulo: "Actividad", obligatoria: true, ejemplo: "Limpiar sensores de pliego" },
  { clave: "baseFecha", titulo: "Fecha de la última mantención (AAAA-MM-DD)", ejemplo: "" },
  { clave: "baseGiros", titulo: "Giros de la última mantención", ejemplo: "" },
];

/** Quita tildes, mayúsculas y signos: sirve para comparar encabezados y valores escritos a mano. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type Fila = Record<string, string>;

export class ErrorDeCarga extends ErrorDeNegocio {
  constructor(public errores: string[]) {
    super(`La planilla tiene ${errores.length} ${errores.length === 1 ? "error" : "errores"}. No se cargó nada.`);
  }
}

class Deshacer extends Error {}

const MAX_FILAS = 2000;

/**
 * Procesa cada fila dentro de una sola transacción. Los errores se juntan con su número de fila
 * de la planilla (la fila 1 es el encabezado) y, si hay alguno, se deshace todo.
 */
async function cargar(
  db: DB,
  filas: Fila[],
  columnas: Columna[],
  procesar: (tx: DB, fila: Fila) => Promise<void>,
): Promise<number> {
  if (filas.length === 0) throw new ErrorDeNegocio("La planilla no tiene filas con datos.");
  if (filas.length > MAX_FILAS) throw new ErrorDeNegocio(`La planilla tiene más de ${MAX_FILAS} filas.`);
  const errores: string[] = [];
  try {
    await db.transaction(async (tx) => {
      for (const [i, fila] of filas.entries()) {
        const n = i + 2;
        const falta = columnas.find((c) => c.obligatoria && !fila[c.clave]?.trim());
        if (falta) {
          errores.push(`Fila ${n}: falta "${falta.titulo}".`);
          continue;
        }
        try {
          // Transacción anidada: si esta fila falla, se deshace solo ella y se sigue revisando el resto.
          await (tx as unknown as DB).transaction((sub) => procesar(sub as unknown as DB, fila));
        } catch (e) {
          if (!(e instanceof ErrorDeNegocio)) throw e;
          errores.push(`Fila ${n}: ${e.message}`);
        }
      }
      if (errores.length > 0) throw new Deshacer();
    });
  } catch (e) {
    if (e instanceof Deshacer) throw new ErrorDeCarga(errores);
    throw e;
  }
  return filas.length;
}

export async function importarActivos(db: DB, actor: UsuarioSesion, filas: Fila[]): Promise<number> {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para cargar activos.");
  }
  const listaPlantas = await db.select().from(plantas);
  return cargar(db, filas, COLUMNAS_ACTIVOS, async (tx, f) => {
    const planta = listaPlantas.find((p) => normalizar(p.nombre) === normalizar(f.planta));
    if (!planta) throw new ErrorDeNegocio(`no existe la planta "${f.planta}".`);
    const condicion = normalizar(f.condicionLlegada ?? "");
    if (condicion && condicion !== "nueva" && condicion !== "usada") {
      throw new ErrorDeNegocio('la condición de llegada debe ser "Nueva" o "Usada".');
    }
    await crearActivo(tx, actor, { ...f, codigo: f.codigo, nombre: f.nombre, plantaId: planta.id, condicionLlegada: condicion.toUpperCase() });
  });
}

const PERFILES: Record<string, Perfil> = {
  administrador: "ADMINISTRADOR",
  jefeplanificador: "JEFE_PLANIFICADOR",
  jefe: "JEFE_PLANIFICADOR",
  planificador: "JEFE_PLANIFICADOR",
  tecnico: "TECNICO",
  operador: "OPERADOR",
  bodeguero: "BODEGUERO",
  abastecimiento: "ABASTECIMIENTO",
};

const MODALIDADES: Record<string, Modalidad> = {
  turnos: "TURNOS",
  turnosrotativos: "TURNOS",
  horariofijo: "HORARIO_FIJO",
};

export async function importarUsuarios(db: DB, actor: UsuarioSesion, filas: Fila[]): Promise<number> {
  if (actor.perfil !== "ADMINISTRADOR") throw new ErrorDeNegocio("Solo el administrador puede cargar usuarios.");
  const listaEspecialidades = await db.select().from(especialidades).where(eq(especialidades.activa, true));
  return cargar(db, filas, COLUMNAS_USUARIOS, async (tx, f) => {
    const perfil = PERFILES[normalizar(f.perfil)];
    if (!perfil) throw new ErrorDeNegocio(`no existe el perfil "${f.perfil}".`);
    let especialidadId: number | undefined;
    let modalidad: Modalidad | undefined;
    if (perfil === "TECNICO") {
      const esp = listaEspecialidades.find(
        (e) => normalizar(e.nombre) === normalizar(f.especialidad ?? "") || normalizar(e.codigo) === normalizar(f.especialidad ?? ""),
      );
      if (!esp) throw new ErrorDeNegocio(`no existe la especialidad "${f.especialidad ?? ""}".`);
      modalidad = MODALIDADES[normalizar(f.modalidad ?? "")];
      if (!modalidad) throw new ErrorDeNegocio('la modalidad debe ser "Turnos" u "Horario fijo".');
      especialidadId = esp.id;
    }
    await crearUsuario(tx, actor, {
      nombre: f.nombre,
      perfil,
      identificador: f.identificador,
      clave: f.clave,
      email: f.email,
      especialidadId,
      modalidad,
    });
  });
}

/** Número entero escrito con o sin puntos de miles. */
function enteroDePlanilla(valor: string | undefined, etiqueta: string): number | null {
  const limpio = (valor ?? "").trim().replace(/[.\s]/g, "");
  if (!limpio) return null;
  if (!/^\d+$/.test(limpio)) throw new ErrorDeNegocio(`${etiqueta}: "${valor}" no es un número entero.`);
  return Number(limpio);
}

/**
 * Carga el plan de mantenimiento: cada máquina con sus propias cartillas e intervalos.
 * Una fila por actividad; las filas que repiten máquina y cartilla forman una sola cartilla,
 * y sus datos (tipo, intervalo, especialidad, punto de partida) se toman de la primera fila.
 */
export async function importarPautas(db: DB, actor: UsuarioSesion, filas: Fila[]): Promise<number> {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para cargar pautas.");
  }
  const [maquinas, listaEsp, existentes] = await Promise.all([
    db.select({ id: activos.id, codigo: activos.codigo }).from(activos),
    db.select().from(especialidades).where(eq(especialidades.activa, true)),
    db.select({ activoId: pautas.activoId, nombre: pautas.nombre }).from(pautas),
  ]);
  const clave = (f: Fila) => `${normalizar(f.codigo ?? "")}|${normalizar(f.pauta ?? "")}`;
  const vistas = new Set<string>();
  let creadas = 0;
  await cargar(db, filas, COLUMNAS_PAUTAS, async (tx, f) => {
    const maquina = maquinas.find((m) => normalizar(m.codigo) === normalizar(f.codigo));
    if (!maquina) throw new ErrorDeNegocio(`no existe el activo "${f.codigo}".`);
    if (f.grupo?.trim() && !grupoPorNombre(f.grupo, listaEsp)) {
      throw new ErrorDeNegocio(`"${f.grupo}" no es un grupo válido: usa Operador o el nombre de una especialidad.`);
    }
    // Solo la primera fila de cada cartilla la crea; las demás aportan su actividad.
    if (vistas.has(clave(f))) return;
    vistas.add(clave(f));
    if (existentes.some((e) => e.activoId === maquina.id && normalizar(e.nombre) === normalizar(f.pauta))) {
      throw new ErrorDeNegocio(`la máquina ${f.codigo} ya tiene una cartilla llamada "${f.pauta}".`);
    }
    const tipo = normalizar(f.tipo);
    if (tipo !== "tiempo" && tipo !== "giros") throw new ErrorDeNegocio('"Se mide por" debe ser Tiempo o Giros.');
    const responsable = grupoPorNombre(f.especialidad, listaEsp);
    if (!responsable || responsable.operador || responsable.especialidadId === null) {
      throw new ErrorDeNegocio(`no existe la especialidad "${f.especialidad}".`);
    }
    const actividades = filas
      .filter((otra) => clave(otra) === clave(f) && otra.actividad?.trim())
      .map((otra) => (otra.grupo?.trim() ? `${otra.grupo.trim()}: ${otra.actividad.trim()}` : otra.actividad.trim()))
      .join("\n");
    await crearPauta(tx, actor, {
      activoId: maquina.id,
      nombre: f.pauta,
      tipo: tipo.toUpperCase(),
      intervalo: enteroDePlanilla(f.intervalo, "Intervalo") ?? NaN,
      especialidadId: responsable.especialidadId,
      actividades,
      baseFecha: f.baseFecha?.trim() || null,
      baseGiros: enteroDePlanilla(f.baseGiros, "Giros de la última mantención"),
    });
    creadas++;
  });
  return creadas;
}
