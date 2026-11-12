import "server-only";
import { sendNotification } from "web-push";
import { db } from "@/db";
import { despacharPush, type Enviador } from "./push-core";

/** Clave pública VAPID, o null si las notificaciones push no están configuradas. */
export function clavePublicaPush(): string | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY ? VAPID_PUBLIC_KEY : null;
}

const enviarWebPush: Enviador = async (s, m) => {
  try {
    await sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(m),
      {
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT || "mailto:soporte@localhost",
          publicKey: process.env.VAPID_PUBLIC_KEY!,
          privateKey: process.env.VAPID_PRIVATE_KEY!,
        },
        TTL: 15 * 60,
        urgency: "high",
      },
    );
    return "ok";
  } catch (e) {
    const estado = (e as { statusCode?: number }).statusCode;
    return estado === 404 || estado === 410 ? "caducada" : "error";
  }
};

/** Se llama después de cada acción; nunca debe hacer fallar a quien la invoca. */
export async function despacharPendientes(): Promise<void> {
  try {
    await despacharPush(db, clavePublicaPush() ? enviarWebPush : null);
  } catch (e) {
    console.error("No se pudieron despachar las notificaciones push:", e);
  }
}
