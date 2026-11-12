// Carga inicial desde planillas: activos, usuarios y plan de mantenimiento. Todo o nada: si una fila falla, no se carga ninguna.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { especialidades, plantas, type Modalidad, type Perfil } from "@/db/schema";
import { crearActivo } from "./activos-core";
import type { UsuarioSesion } from "./auth-core";
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
        const n = Number(fila._fila) || i + 2;
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
