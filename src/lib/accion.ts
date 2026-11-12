import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { despacharPendientes } from "./push";
import { ErrorDeNegocio } from "./usuarios-core";

/**
 * Ejecuta una acción de formulario. Si la regla de negocio la rechaza, vuelve a la pantalla
 * de origen con el mensaje; si funciona, va al destino que devuelva la acción (o al origen).
 */
export async function ejecutar(
  origen: string,
  accion: () => Promise<string | void>,
): Promise<never> {
  let destino: string;
  try {
    destino = (await accion()) ?? origen;
  } catch (e) {
    if (!(e instanceof ErrorDeNegocio)) throw e;
    const separador = origen.includes("?") ? "&" : "?";
    redirect(`${origen}${separador}error=${encodeURIComponent(e.message)}`);
  }
  // Los avisos generados por la acción se envían al celular una vez respondida la solicitud.
  after(despacharPendientes);
  revalidatePath("/", "layout");
  redirect(destino);
}

export function entero(valor: FormDataEntryValue | null): number {
  const n = Number(valor);
  return Number.isInteger(n) ? n : NaN;
}

export function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor : "";
}
