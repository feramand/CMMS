// Validación y normalización de RUT chileno.

/** Dígito verificador (módulo 11) para el cuerpo numérico de un RUT. */
export function digitoVerificador(cuerpo: number): string {
  let suma = 0;
  let factor = 2;
  for (let n = cuerpo; n > 0; n = Math.floor(n / 10)) {
    suma += (n % 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * Devuelve el RUT en formato canónico "12345678-5" o null si no es válido.
 * Acepta puntos, guion opcional, espacios y la K en minúscula.
 */
export function normalizarRut(crudo: string): string | null {
  const limpio = crudo.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{1,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = Number(limpio.slice(0, -1));
  const dv = limpio.slice(-1);
  if (cuerpo < 1) return null;
  if (digitoVerificador(cuerpo) !== dv) return null;
  return `${cuerpo}-${dv}`;
}
