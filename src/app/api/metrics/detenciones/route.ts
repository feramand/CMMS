import { responder } from "../responder";

/** Detención clasificada por el operador, enviada por el conector de Metrics. */
export function POST(request: Request) {
  return responder(request, "DETENCION");
}
