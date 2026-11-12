import { responder } from "../responder";

/** Lectura de giros acumulados de una máquina, enviada por el conector de Metrics. */
export function POST(request: Request) {
  return responder(request, "GIROS");
}
