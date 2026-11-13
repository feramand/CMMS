import { after } from "next/server";
import { db } from "@/db";
import { claveValida, recibirDeMetrics } from "@/lib/metrics-core";
import { despacharPendientes } from "@/lib/push";

/**
 * Entrada común de los mensajes del conector. Exige la clave METRICS_API_KEY en el
 * encabezado «Authorization: Bearer …». Responde 200 si el mensaje se procesó o se ignoró
 * a propósito, y 422 si venía mal: en ese caso el conector no debe reintentarlo sin corregirlo.
 */
export async function responder(request: Request, tipo: "GIROS" | "DETENCION" | "FIN_DETENCION"): Promise<Response> {
  const esperada = process.env.METRICS_API_KEY;
  if (!esperada) return Response.json({ error: "La integración con Metrics no está configurada." }, { status: 503 });
  const recibida = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!claveValida(recibida, esperada)) return Response.json({ error: "Clave no válida." }, { status: 401 });
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }
  const salida = await recibirDeMetrics(db, tipo, cuerpo);
  // Los avisos que generó el mensaje salen al celular una vez respondido el conector.
  after(despacharPendientes);
  return Response.json(salida, { status: salida.resultado === "ERROR" ? 422 : 200 });
}
