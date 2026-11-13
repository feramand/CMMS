import type { Categoria } from "@/db/schema";

export const CATEGORIAS: { valor: Categoria; nombre: string }[] = [
  { valor: "MECANICA", nombre: "Mecánica" },
  { valor: "ELECTRICA", nombre: "Eléctrica" },
  { valor: "INDETERMINADA", nombre: "Indeterminada" },
  { valor: "SAC", nombre: "Apoyo crítico (SAC)" },
  { valor: "SERVICIOS_GENERALES", nombre: "Servicios generales" },
];

/**
 * Breakdown Downtime (BD): falla real del equipo con la máquina detenida. Es la parte de las
 * detenciones no planificadas (Delay) que atiende mantenimiento y la única que entra al MTTR y al MTBF.
 * En Metrics hay un código por tipo; el «BD General» es el que llega sin clasificar.
 */
export const TIPOS_BD: { valor: Categoria; nombre: string }[] = [
  { valor: "MECANICA", nombre: "BD Mecánico" },
  { valor: "ELECTRICA", nombre: "BD Eléctrico" },
  { valor: "SAC", nombre: "BD SAC" },
  { valor: "INDETERMINADA", nombre: "BD General" },
];

export const esBd = (c: Categoria) => TIPOS_BD.some((t) => t.valor === c);

export function nombreBd(c: Categoria): string {
  return TIPOS_BD.find((t) => t.valor === c)?.nombre ?? nombreCategoria(c);
}

export function nombreCategoria(c: Categoria): string {
  return CATEGORIAS.find((x) => x.valor === c)?.nombre ?? c;
}

/**
 * Códigos de especialidad que atienden cada categoría de falla.
 * Una falla indeterminada la ven mecánicos y eléctricos; la toma el primero.
 */
export function especialidadesDe(categoria: Categoria): string[] {
  switch (categoria) {
    case "MECANICA":
      return ["MEC"];
    case "ELECTRICA":
      return ["ELE"];
    case "INDETERMINADA":
      return ["MEC", "ELE"];
    case "SAC":
      return ["SAC"];
    case "SERVICIOS_GENERALES":
      return ["SSGG"];
  }
}

/** Categorías que ve un técnico según el código de su especialidad. */
export function categoriasDe(codigoEspecialidad: string): Categoria[] {
  return CATEGORIAS.map((c) => c.valor).filter((c) =>
    especialidadesDe(c).includes(codigoEspecialidad),
  );
}

/** Orígenes reales válidos al cerrar una solicitud indeterminada. */
export const ORIGENES_REALES: Categoria[] = ["MECANICA", "ELECTRICA", "SAC"];
