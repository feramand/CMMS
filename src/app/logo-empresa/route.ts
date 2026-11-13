import { readFile } from "node:fs/promises";
import path from "node:path";
import { tipoDeImagen } from "@/lib/adjuntos-core";
import { usuarioActual } from "@/lib/dal";
import { EMPRESA } from "@/lib/empresa";

// Logo de la empresa para la orden de compra impresa. El archivo vive fuera del código: lo indica EMPRESA_LOGO.
export async function GET() {
  if (!(await usuarioActual())) return new Response("No autorizado", { status: 401 });
  if (!EMPRESA.logo) return new Response("No encontrado", { status: 404 });
  try {
    const contenido = await readFile(path.resolve(/* turbopackIgnore: true */ EMPRESA.logo));
    const tipo = tipoDeImagen(new Uint8Array(contenido));
    if (!tipo) return new Response("No encontrado", { status: 404 });
    return new Response(new Uint8Array(contenido), {
      headers: { "Content-Type": tipo.tipo, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
