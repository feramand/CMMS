import Link from "next/link";
import { MenuBodega } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { tarjeta } from "@/componentes/ui";
import { operaBodega } from "@/lib/bodega-core";
import { solicitudesPendientes } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { fechaHora } from "@/lib/tiempo";

export default async function SolicitudesDeRepuesto() {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const pendientes = await solicitudesPendientes();
  const opera = operaBodega(usuario);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Solicitudes de repuesto pendientes · {pendientes.length}</h1>
        <MenuBodega actual="/bodega/solicitudes" opera={opera} />
        {pendientes.length === 0 && <p className="text-slate-600">No hay solicitudes pendientes.</p>}
        {pendientes.map((s) => (
          <div key={s.id} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
            <div className="flex flex-col">
              <span className="text-lg font-semibold">
                {s.cantidad} × {s.descripcion}
              </span>
              <span className="text-slate-700">
                {s.activo}
                {s.folio ? ` · OT ${s.folio}` : ""}
                {s.codigo ? ` · ${s.codigo}` : ""}
              </span>
              <span className="text-sm text-slate-600">
                Pidió {s.solicitante} · {fechaHora(s.creadaEn)}
              </span>
            </div>
            {opera && (
              <Link href={`/bodega/solicitud/${s.id}`} className="flex h-12 items-center rounded-lg bg-marca px-5 text-base font-semibold text-white">
                Atender
              </Link>
            )}
          </div>
        ))}
      </main>
    </>
  );
}
