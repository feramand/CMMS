// Notificaciones push: suscripción de dispositivos y despacho de avisos pendientes.
// El envío real se inyecta como función para poder probar la lógica sin salir a internet.
import { eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { notificaciones, suscripcionesPush } from "@/db/schema";
import type { UsuarioSesion } from "./auth-core";
import { ErrorDeNegocio } from "./usuarios-core";

export type Suscripcion = { endpoint: string; p256dh: string; auth: string };
export type MensajePush = { titulo: string; cuerpo: string; url: string };
/** "caducada": el navegador dio de baja esa suscripción y hay que borrarla. */
export type ResultadoEnvio = "ok" | "caducada" | "error";
export type Enviador = (s: Suscripcion, m: MensajePush) => Promise<ResultadoEnvio>;

/** Un aviso más antiguo que esto ya no se envía al celular (queda solo en la aplicación). */
export const MINUTOS_VIGENCIA = 15;

export async function guardarSuscripcion(db: DB, actor: UsuarioSesion, s: Suscripcion): Promise<void> {
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    throw new ErrorDeNegocio("La suscripción no es válida.");
  }
  if (url.protocol !== "https:" || !s.p256dh || !s.auth) {
    throw new ErrorDeNegocio("La suscripción no es válida.");
  }
  // Un mismo dispositivo pertenece a quien inició sesión en él por última vez.
  await db
    .insert(suscripcionesPush)
    .values({ usuarioId: actor.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
    .onConflictDoUpdate({
      target: suscripcionesPush.endpoint,
      set: { usuarioId: actor.id, p256dh: s.p256dh, auth: s.auth },
    });
}

export async function quitarSuscripcion(db: DB, endpoint: string): Promise<void> {
  await db.delete(suscripcionesPush).where(eq(suscripcionesPush.endpoint, endpoint));
}

/**
 * Envía al celular los avisos que aún no se han despachado.
 * Cada aviso se reclama una sola vez, aunque dos procesos despachen a la vez.
 * Con `enviar` nulo (push sin configurar) los avisos se marcan como despachados sin enviarse.
 */
export async function despacharPush(
  db: DB,
  enviar: Enviador | null,
  ahora: Date = new Date(),
): Promise<{ avisos: number; enviados: number; caducadas: number; errores: number }> {
  const reclamados = await db
    .update(notificaciones)
    .set({ pushEnviadaEn: ahora })
    .where(isNull(notificaciones.pushEnviadaEn))
    .returning({
      usuarioId: notificaciones.usuarioId,
      mensaje: notificaciones.mensaje,
      enlace: notificaciones.enlace,
      creadaEn: notificaciones.creadaEn,
    });
  const limite = ahora.getTime() - MINUTOS_VIGENCIA * 60 * 1000;
  const vigentes = reclamados.filter((n) => n.creadaEn.getTime() >= limite);
  const resumen = { avisos: vigentes.length, enviados: 0, caducadas: 0, errores: 0 };
  if (!enviar || vigentes.length === 0) return resumen;

  const dispositivos = await db
    .select()
    .from(suscripcionesPush)
    .where(inArray(suscripcionesPush.usuarioId, [...new Set(vigentes.map((n) => n.usuarioId))]));
  const caducadas = new Set<string>();
  await Promise.all(
    vigentes.flatMap((n) =>
      dispositivos
        .filter((d) => d.usuarioId === n.usuarioId)
        .map(async (d) => {
          let r: ResultadoEnvio;
          try {
            r = await enviar(d, { titulo: "Print Garage", cuerpo: n.mensaje, url: n.enlace ?? "/" });
          } catch {
            r = "error";
          }
          if (r === "ok") resumen.enviados++;
          else if (r === "caducada") caducadas.add(d.endpoint);
          else resumen.errores++;
        }),
    ),
  );
  if (caducadas.size > 0) {
    await db.delete(suscripcionesPush).where(inArray(suscripcionesPush.endpoint, [...caducadas]));
  }
  resumen.caducadas = caducadas.size;
  return resumen;
}
