import { COLUMNAS_REPUESTOS } from "@/lib/bodega-core";
import { usuarioActual } from "@/lib/dal";
import { plantilla } from "@/lib/excel";

export async function GET() {
  const usuario = await usuarioActual();
  if (!usuario || (usuario.perfil !== "BODEGUERO" && usuario.perfil !== "ADMINISTRADOR")) {
    return new Response("No autorizado", { status: 403 });
  }
  const archivo = await plantilla("Repuestos", COLUMNAS_REPUESTOS);
  return new Response(new Uint8Array(archivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-repuestos.xlsx"',
    },
  });
}
