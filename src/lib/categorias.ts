import type { Categoria } from "@/db/schema";

export const CATEGORIAS: { valor: Categoria; nombre: string }[] = [
  { valor: "MECANICA", nombre: "Mecánica" },
  { valor: "ELECTRICA", nombre: "Eléctrica" },
  { valor: "INDETERMINADA", nombre: "Indeterminada" },
  { valor: "SAC", nombre: "Apoyo crítico (SAC)" },
  { valor: "SERVICIOS_GENERALES", nombre: "Servicios generales" },
];

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
