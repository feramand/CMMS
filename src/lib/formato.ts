/** Pesos chilenos, sin decimales: $1.250.000. */
export function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

/** Cantidad con hasta 2 decimales y separador chileno: 1.234,5. */
export function cant(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}

/** Monto en la moneda de una orden de compra: pesos sin decimales; el resto, con 2 (o hasta 4 en precios). */
export function monto(n: number, moneda: string, decimales = 2): string {
  if (moneda === "CLP") return pesos(n);
  return `${moneda} ${n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: decimales })}`;
}
