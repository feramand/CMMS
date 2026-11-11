import type { Perfil } from "@/db/schema";

export const PERFILES: { valor: Perfil; nombre: string }[] = [
  { valor: "ADMINISTRADOR", nombre: "Administrador" },
  { valor: "JEFE_PLANIFICADOR", nombre: "Jefe / Planificador" },
  { valor: "TECNICO", nombre: "Técnico" },
  { valor: "OPERADOR", nombre: "Operador" },
  { valor: "BODEGUERO", nombre: "Bodeguero" },
  { valor: "ABASTECIMIENTO", nombre: "Abastecimiento" },
];

export function nombrePerfil(perfil: Perfil): string {
  return PERFILES.find((p) => p.valor === perfil)?.nombre ?? perfil;
}

/** Perfiles operativos: entran con PIN de 4 dígitos. El resto usa contraseña. */
export function usaPin(perfil: Perfil): boolean {
  return perfil === "TECNICO" || perfil === "OPERADOR" || perfil === "BODEGUERO";
}

/** Los operadores se identifican con su usuario de Metrics; todos los demás, con su RUT. */
export function usaUsuarioMetrics(perfil: Perfil): boolean {
  return perfil === "OPERADOR";
}

export function puedeEntrarAdmin(perfil: Perfil): boolean {
  return (
    perfil === "ADMINISTRADOR" ||
    perfil === "JEFE_PLANIFICADOR" ||
    perfil === "ABASTECIMIENTO"
  );
}

export function rutaInicio(perfil: Perfil): string {
  return puedeEntrarAdmin(perfil) ? "/admin" : "/inicio";
}

export function puedeGestionarUsuarios(perfil: Perfil): boolean {
  return perfil === "ADMINISTRADOR";
}

/**
 * Quién puede restablecer la clave o desbloquear a quién:
 * el administrador a cualquiera; jefe y planificador solo a técnicos y operadores.
 */
export function puedeRestablecerClave(actor: Perfil, objetivo: Perfil): boolean {
  if (actor === "ADMINISTRADOR") return true;
  if (actor === "JEFE_PLANIFICADOR") {
    return objetivo === "TECNICO" || objetivo === "OPERADOR";
  }
  return false;
}
