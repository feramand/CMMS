import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adjuntos, solicitudes, solicitudesRepuesto } from "@/db/schema";
import { rutaAdjunto } from "@/lib/adjuntos-core";
import { usuarioActual } from "@/lib/dal";

// Entrega una foto adjunta solo a quien tiene sesión y permiso para verla.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioActual();
  if (!usuario) return new Response("No autorizado", { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response("No encontrado", { status: 404 });
  const [a] = await db.select().from(adjuntos).where(eq(adjuntos.id, id));
  if (!a) return new Response("No encontrado", { status: 404 });

  // Las cotizaciones de una orden de compra solo las ve quien entra a compras.
  if (a.ocId && (usuario.perfil === "TECNICO" || usuario.perfil === "OPERADOR")) return new Response("No autorizado", { status: 403 });

  if (usuario.perfil === "OPERADOR") {
    // El operador solo ve las fotos de las solicitudes que él levantó.
    const solicitudId =
      a.solicitudId ??
      (a.repuestoId
        ? (
            await db
              .select({ id: solicitudesRepuesto.solicitudId })
              .from(solicitudesRepuesto)
              .where(eq(solicitudesRepuesto.id, a.repuestoId))
          )[0]?.id
        : null);
    const [s] = solicitudId
      ? await db.select({ creadaPor: solicitudes.creadaPor }).from(solicitudes).where(eq(solicitudes.id, solicitudId))
      : [];
    if (!s || s.creadaPor !== usuario.id) return new Response("No autorizado", { status: 403 });
  }

  let contenido: Buffer;
  try {
    contenido = await readFile(rutaAdjunto(a.archivo));
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
  return new Response(new Uint8Array(contenido), {
    headers: {
      "Content-Type": a.tipo,
      "Content-Length": String(contenido.length),
      "X-Content-Type-Options": "nosniff",
      // Un PDF subido por terceros no debe ejecutar nada en el origen de la aplicación.
      "Content-Security-Policy": "sandbox",
      ...(a.tipo === "application/pdf" ? { "Content-Disposition": `attachment; filename="cotizacion-${a.id}.pdf"` } : {}),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
