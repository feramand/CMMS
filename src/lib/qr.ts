import "server-only";
import { headers } from "next/headers";
import { toString as qrComoTexto } from "qrcode";

/**
 * Dirección con la que las personas abren el sistema. Conviene fijarla con URL_PUBLICA,
 * porque queda impresa en las etiquetas; si falta, se usa la dirección de la visita actual.
 */
export async function urlBase(): Promise<string> {
  const fija = process.env.URL_PUBLICA?.trim().replace(/\/+$/, "");
  if (fija) return fija;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const protocolo = h.get("x-forwarded-proto") ?? "http";
  return `${protocolo}://${host}`;
}

/** Dirección que lleva el QR de una máquina. Usa el número interno, que nunca cambia. */
export async function urlDeActivo(id: number): Promise<string> {
  return `${await urlBase()}/activo/${id}`;
}

/** Código QR como SVG. Nivel de corrección Q: se sigue leyendo con la etiqueta algo dañada o sucia. */
export function qrSvg(texto: string): Promise<string> {
  return qrComoTexto(texto, { type: "svg", errorCorrectionLevel: "Q", margin: 2 });
}
