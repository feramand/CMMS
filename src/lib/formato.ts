/** Pesos chilenos, sin decimales: $1.250.000. */
export function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

/** Cantidad con hasta 2 decimales y separador chileno: 1.234,5. */
export function cant(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}
