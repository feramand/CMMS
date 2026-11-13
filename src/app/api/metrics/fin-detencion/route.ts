import { responder } from "../responder";

/** Fin de una detención: la máquina volvió a producir. Enviado por el conector de Metrics. */
export function POST(request: Request) {
  return responder(request, "FIN_DETENCION");
}
