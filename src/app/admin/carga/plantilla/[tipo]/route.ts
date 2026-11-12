import { COLUMNAS_ACTIVOS, COLUMNAS_USUARIOS } from "@/lib/carga-core";
import { COLUMNAS_CARTILLA } from "@/lib/cartilla-core";
import { usuarioActual } from "@/lib/dal";
import { plantilla } from "@/lib/excel";

const PLANTILLAS = {
  activos: { hoja: "Activos", columnas: COLUMNAS_ACTIVOS, perfiles: ["ADMINISTRADOR", "JEFE_PLANIFICADOR"] },
  cartilla: { hoja: "Cartilla", columnas: COLUMNAS_CARTILLA, perfiles: ["ADMINISTRADOR", "JEFE_PLANIFICADOR"] },
  usuarios: { hoja: "Usuarios", columnas: COLUMNAS_USUARIOS, perfiles: ["ADMINISTRADOR"] },
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const usuario = await usuarioActual();
  const { tipo } = await params;
  const p = PLANTILLAS[tipo as keyof typeof PLANTILLAS];
  if (!p) return new Response("No encontrado", { status: 404 });
  if (!usuario || !(p.perfiles as readonly string[]).includes(usuario.perfil)) {
    return new Response("No autorizado", { status: 403 });
  }
  const archivo = await plantilla(p.hoja, [...p.columnas]);
  return new Response(new Uint8Array(archivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-${tipo}.xlsx"`,
    },
  });
}
