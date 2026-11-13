// Carga de las cartillas de mantenimiento de una máquina desde la planilla de la planta:
// una fila por tarea, con su código, ubicación, pauta, encargado, detención, insumos y tiempo.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { activos, especialidades, pautas } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeCarga, normalizar, type Columna, type Fila } from "./carga-core";
import { crearPauta, grupoPorNombre, type TareaDatos } from "./pautas-core";
import { asegurarRuta } from "./sistemas-core";
import { ErrorDeNegocio } from "./usuarios-core";

export const COLUMNAS_CARTILLA: Columna[] = [
  { clave: "codigo", titulo: "CÓDIGO", obligatoria: true, ejemplo: "MPO-PP-SMXL-001" },
  { clave: "zona", titulo: "ZONA (Módulo)", ejemplo: "Marcador" },
  { clave: "subsistema", titulo: "SUBSISTEMA", ejemplo: "Pila de entrada" },
  { clave: "componente", titulo: "COMPONENTE", ejemplo: "Sensores de altura de pila" },
  { clave: "pauta", titulo: "PAUTA", obligatoria: true, ejemplo: "A" },
  { clave: "tipoTarea", titulo: "TIPO", ejemplo: "Limpieza" },
  { clave: "encargado", titulo: "ENCARGADO", obligatoria: true, ejemplo: "Operador" },
  { clave: "detencion", titulo: "DETENCIÓN", ejemplo: "SI" },
  { clave: "tarea", titulo: "TAREA", obligatoria: true, ejemplo: "Limpiar sensores de altura de pila" },
  { clave: "insumos", titulo: "INSUMOS", ejemplo: "Paño de microfibra sin pelusa" },
  { clave: "minutos", titulo: "TIEMPO (MINUTOS)", ejemplo: "5" },
  { clave: "frecuencia", titulo: "FRECUENCIA", ejemplo: "Quincenal" },
  { clave: "equivalencia", titulo: "Equivalencia Giros", ejemplo: "400000" },
];

/** Días de cada frecuencia escrita en palabras, para las cartillas que se miden por tiempo. */
const DIAS_FRECUENCIA: Record<string, number> = {
  diaria: 1, diario: 1, semanal: 7, quincenal: 15, mensual: 30, bimestral: 60, bimensual: 60,
  trimestral: 90, cuatrimestral: 120, semestral: 180, anual: 365,
};

const DETENCION: Record<string, string> = { si: "SI", no: "NO", parcial: "PARCIAL" };

function entero(valor: string | undefined): number | null {
  const limpio = (valor ?? "").trim().replace(/[.\s]/g, "");
  return /^\d+$/.test(limpio) ? Number(limpio) : null;
}

export type ResumenCartilla = { cartillas: { nombre: string; tareas: number; intervalo: string }[]; tareas: number };

/**
 * Crea las cartillas de una máquina a partir de la planilla. Reglas:
 * - La columna PAUTA separa las cartillas. Una pauta escrita con las letras de otras
 *   (por ejemplo "AB" cuando existen "A" y "B") indica una cartilla que se alterna: "Pauta A/B" hace
 *   una vuelta las tareas A y a la siguiente las B; las tareas "AB" van en todas las vueltas. Esa cartilla
 *   se mide por tiempo (su FRECUENCIA), aunque la planilla traiga equivalencia en giros.
 * - Con «Equivalencia Giros» la cartilla se mide por el contador de la máquina; sin ella,
 *   por tiempo según la FRECUENCIA. Ninguna de las dos columnas se muestra a quien ejecuta.
 * - ENCARGADO puede nombrar dos grupos separados por "/" ("Operador/Mecánico"): cualquiera la marca.
 * - Las filas sin código y sin pauta (títulos, totalizador, pie de firma) se ignoran.
 * - Todo o nada: si una fila tiene un error no se crea ninguna cartilla.
 */
export async function importarCartilla(db: DB, actor: UsuarioSesion, activoId: number, filas: Fila[], ahora = new Date()): Promise<ResumenCartilla> {
  if (actor.perfil !== "ADMINISTRADOR" && actor.perfil !== "JEFE_PLANIFICADOR") {
    throw new ErrorDeNegocio("No tienes permiso para cargar cartillas.");
  }
  const [maquina] = await db.select().from(activos).where(eq(activos.id, activoId));
  if (!maquina) throw new ErrorDeNegocio("Elige la máquina a la que pertenecen las cartillas.");
  // Una tarea tiene código o pauta. El pie de la planilla (estado de la orden, totalizador, firma) no tiene ninguno.
  const datos = filas.filter((f) => f.codigo?.trim() || f.pauta?.trim());
  if (datos.length === 0) throw new ErrorDeNegocio("La planilla no tiene tareas.");
  const [listaEsp, existentes] = await Promise.all([
    db.select().from(especialidades).where(eq(especialidades.activa, true)),
    db.select({ nombre: pautas.nombre }).from(pautas).where(eq(pautas.activoId, activoId)),
  ]);
  const mecanica = listaEsp.find((e) => e.codigo === "MEC") ?? listaEsp[0];
  if (!mecanica) throw new ErrorDeNegocio("No hay especialidades creadas.");

  const errores: string[] = [];
  const etiquetas = [...new Set(datos.map((f) => (f.pauta ?? "").trim().toUpperCase()).filter(Boolean))];
  // "AB" junto a "A" y "B": una sola cartilla que se alterna. Una vuelta se hace la A y a la siguiente la B;
  // las tareas "AB" van en todas las vueltas.
  const compuestas = etiquetas
    .filter((e) => e.length > 1 && [...e].every((letra) => etiquetas.includes(letra)))
    .sort((x, y) => y.length - x.length);
  const grupoDeLetra = new Map<string, string>();
  for (const c of compuestas) {
    if ([...c].every((letra) => !grupoDeLetra.has(letra))) for (const letra of c) grupoDeLetra.set(letra, c);
  }
  /** Cartilla a la que va una etiqueta y, si se alterna, en qué vuelta. null = combinación que no se puede cargar. */
  const destino = (etiqueta: string): { clave: string; variante: string | null } | null => {
    if (compuestas.includes(etiqueta)) return grupoDeLetra.get(etiqueta[0]) === etiqueta ? { clave: etiqueta, variante: null } : null;
    const grupo = grupoDeLetra.get(etiqueta);
    return grupo ? { clave: grupo, variante: etiqueta } : { clave: etiqueta, variante: null };
  };

  type Grupo = { etiqueta: string; alterna: boolean; frecuencia: string; equivalencia: number | null; tareas: TareaDatos[]; filas: Fila[] };
  const grupos = new Map<string, Grupo>();
  for (const e of etiquetas) {
    const d = destino(e);
    if (d && !grupos.has(d.clave)) {
      const alterna = compuestas.includes(d.clave);
      grupos.set(d.clave, { etiqueta: alterna ? [...d.clave].join("/") : d.clave, alterna, frecuencia: "", equivalencia: null, tareas: [], filas: [] });
    }
  }
  const codigos = new Set<string>();
  for (const f of datos) {
    const n = f._fila ?? "?";
    const falta = COLUMNAS_CARTILLA.find((c) => c.obligatoria && !f[c.clave]?.trim());
    if (falta) {
      errores.push(`Fila ${n}: falta "${falta.titulo}".`);
      continue;
    }
    if (codigos.has(normalizar(f.codigo))) errores.push(`Fila ${n}: el código ${f.codigo} está repetido.`);
    codigos.add(normalizar(f.codigo));
    const encargados = f.encargado.split("/").map((x) => grupoPorNombre(x, listaEsp));
    if (encargados.some((g) => g === null)) {
      errores.push(`Fila ${n}: no reconozco el encargado "${f.encargado}". Usa Operador, Mecánico, Eléctrico u otra especialidad.`);
      continue;
    }
    const detencion = f.detencion?.trim() ? DETENCION[normalizar(f.detencion)] : null;
    if (detencion === undefined) {
      errores.push(`Fila ${n}: la detención debe ser Sí, No o Parcial (dice "${f.detencion}").`);
      continue;
    }
    const minutos = f.minutos?.trim() ? entero(f.minutos) : null;
    if (f.minutos?.trim() && minutos === null) {
      errores.push(`Fila ${n}: el tiempo en minutos debe ser un número entero (dice "${f.minutos}").`);
      continue;
    }
    const tarea: TareaDatos = {
      descripcion: f.tarea.trim(),
      codigo: f.codigo.trim(),
      zona: f.zona?.trim() || null,
      subsistema: f.subsistema?.trim() || null,
      componente: f.componente?.trim() || null,
      tipoTarea: f.tipoTarea?.trim() || null,
      detencion,
      insumos: f.insumos?.trim() || null,
      minutos,
      operador: encargados.some((g) => g!.operador),
      especialidadId: encargados.find((g) => g!.especialidadId !== null)?.especialidadId ?? null,
    };
    const d = destino(f.pauta.trim().toUpperCase());
    if (!d) {
      errores.push(`Fila ${n}: la pauta "${f.pauta}" mezcla cartillas que ya se alternan en otro grupo. Usa una sola combinación (por ejemplo A, B y AB).`);
      continue;
    }
    const g = grupos.get(d.clave)!;
    g.tareas.push({ ...tarea, variante: d.variante });
    g.filas.push(f);
  }

  // Frecuencia y equivalencia de cada cartilla: deben coincidir en todas sus tareas.
  for (const g of grupos.values()) {
    const propias = g.filas;
    const frecuencias = [...new Set(propias.map((f) => (f.frecuencia ?? "").trim()).filter(Boolean))];
    const equivalencias = [...new Set(propias.map((f) => (f.equivalencia ?? "").trim()).filter(Boolean))];
    if (frecuencias.length > 1 || equivalencias.length > 1) {
      errores.push(`Pauta ${g.etiqueta}: sus tareas tienen distinta frecuencia o equivalencia (${[...frecuencias, ...equivalencias].join(", ")}).`);
      continue;
    }
    g.frecuencia = frecuencias[0] ?? "";
    // La cartilla que se alterna es la de menor intervalo: se mide por tiempo si su frecuencia se reconoce.
    if (g.alterna && DIAS_FRECUENCIA[normalizar(g.frecuencia)]) {
      g.equivalencia = null;
    } else if (equivalencias[0]) {
      g.equivalencia = entero(equivalencias[0]);
      if (!g.equivalencia) errores.push(`Pauta ${g.etiqueta}: la equivalencia en giros debe ser un número entero mayor que cero (dice "${equivalencias[0]}").`);
    } else if (!DIAS_FRECUENCIA[normalizar(g.frecuencia)]) {
      errores.push(`Pauta ${g.etiqueta}: indica la equivalencia en giros o una frecuencia conocida (quincenal, mensual, semestral, anual…).`);
    }
    if (existentes.some((e) => normalizar(e.nombre) === normalizar(`Pauta ${g.etiqueta}`))) {
      errores.push(`Pauta ${g.etiqueta}: esta máquina ya tiene una cartilla con ese nombre.`);
    }
  }
  if ([...grupos.values()].some((g) => g.equivalencia) && maquina.girosAcumulados === null) {
    errores.push("La máquina no tiene lecturas de contador: registra una en su ficha antes de cargar cartillas por giros.");
  }
  if (errores.length > 0) throw new ErrorDeCarga(errores);

  const resumen: ResumenCartilla = { cartillas: [], tareas: datos.length };
  await db.transaction(async (tx) => {
    const conexion = tx as unknown as DB;
    for (const f of datos) await asegurarRuta(tx, activoId, [f.zona ?? "", f.subsistema ?? "", f.componente ?? ""]);
    for (const g of grupos.values()) {
      // La especialidad responsable es la técnica con más tareas; sin técnicos, mecánica.
      const cuenta = new Map<number, number>();
      for (const t of g.tareas) if (t.especialidadId) cuenta.set(t.especialidadId, (cuenta.get(t.especialidadId) ?? 0) + 1);
      const responsable = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? mecanica.id;
      const intervalo = g.equivalencia ?? DIAS_FRECUENCIA[normalizar(g.frecuencia)];
      await crearPauta(conexion, actor, {
        activoId,
        nombre: `Pauta ${g.etiqueta}`,
        tipo: g.equivalencia ? "GIROS" : "TIEMPO",
        intervalo,
        especialidadId: responsable,
        frecuencia: g.frecuencia,
        tareas: g.tareas,
      }, ahora);
      resumen.cartillas.push({
        nombre: `Pauta ${g.etiqueta}`,
        tareas: g.tareas.length,
        intervalo: g.equivalencia ? `${intervalo.toLocaleString("es-CL")} ${maquina.unidadContador}` : `${intervalo} días`,
      });
    }
  });
  return resumen;
}
