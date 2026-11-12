import Link from "next/link";
import { ChipOc, ChipSc, MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { tarjeta } from "@/componentes/ui";
import { folioOc, folioSc, propuestaDeCompra } from "@/lib/compras-core";
import { listarOc, listarSc } from "@/lib/consultas-compras";
import { db } from "@/db";
import { exigirPerfil } from "@/lib/dal";
import { monto } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";

export default async function Compras() {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const [scs, ocs, propuesta] = await Promise.all([listarSc(undefined, 100), listarOc(undefined, 100), propuestaDeCompra(db)]);
  const porAprobar = scs.filter((s) => s.estado === "ENVIADA").length;
  const sinOc = scs.filter((s) => s.estado === "APROBADA").length;
  const porAutorizar = ocs.filter((o) => o.estado === "EMITIDA").length;
  const porRecibir = ocs.filter((o) => o.estado === "AUTORIZADA" || o.estado === "RECIBIDA_PARCIAL").length;
  const porComprar = propuesta.filter((p) => p.sugerida > 0).length;
  const numeros = [
    ["Solicitudes por aprobar", porAprobar],
    ["Aprobadas sin orden de compra", sinOc],
    ["Órdenes por autorizar", porAutorizar],
    ["Órdenes por recibir", porRecibir],
  ] as const;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Compras</h1>
        <MenuCompras actual="/compras" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {numeros.map(([nombre, n]) => (
            <div key={nombre} className={tarjeta}>
              <p className="text-sm text-slate-600">{nombre}</p>
              <p className="text-2xl font-bold">{n}</p>
            </div>
          ))}
        </div>
        {porComprar > 0 && (
          <Link href="/compras/sc/nueva?propuesta=1" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base">
            <b>
              {porComprar === 1 ? "Hay 1 repuesto" : `Hay ${porComprar} repuestos`} bajo el stock mínimo sin compra en camino.
            </b>{" "}
            <span className="text-marca underline">Preparar una solicitud de compra con la propuesta</span>
          </Link>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Órdenes de compra</h2>
          {ocs.length === 0 && <p className="text-slate-600">Todavía no hay órdenes de compra.</p>}
          {ocs.map((o) => (
            <Link key={o.id} href={`/compras/oc/${o.id}`} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
              <span className="text-lg font-semibold">
                {folioOc(o.id)} · {o.proveedor}
              </span>
              <span className="text-slate-700">
                {o.lineas.length === 1 ? "1 línea" : `${o.lineas.length} líneas`} · total {monto(o.total, o.moneda)} · {fechaHora(o.emitidaEn)}
              </span>
              <ChipOc estado={o.estado} />
            </Link>
          ))}
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Solicitudes de compra</h2>
          {scs.length === 0 && <p className="text-slate-600">Todavía no hay solicitudes de compra.</p>}
          {scs.map((s) => (
            <Link key={s.id} href={`/compras/sc/${s.id}`} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
              <span className="text-lg font-semibold">
                {folioSc(s.id)} · {s.solicitante}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {s.lineas.map((l) => l.descripcion).join(", ")} · {fechaHora(s.creadaEn)}
              </span>
              <ChipSc estado={s.estado} />
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
