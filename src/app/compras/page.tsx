import Link from "next/link";
import { ChipOc, ChipSc, MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { tarjeta } from "@/componentes/ui";
import { apruebaPsc, folioDe, folioOc, gestionaCompras, propuestaDeCompra, TIPOS_SC } from "@/lib/compras-core";
import { listarOc, listarSc } from "@/lib/consultas-compras";
import { db } from "@/db";
import { exigirPerfil } from "@/lib/dal";
import { monto } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";

export default async function Compras() {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const [todas, ocs, propuesta] = await Promise.all([listarSc(undefined, 300), listarOc(undefined, 100), propuestaDeCompra(db)]);
  // Repositorio de solicitudes: abastecimiento (y el administrador) las ve todas; cada usuario, las
  // suyas y las presolicitudes que le toca aprobar.
  const veTodas = gestionaCompras(usuario);
  const scs = todas.filter((s) => veTodas || s.solicitanteId === usuario.id || (s.estado === "ENVIADA" && apruebaPsc(usuario, s.origen)));
  const porAprobar = scs.filter((s) => s.estado === "ENVIADA").length;
  const esServicio = (o: (typeof ocs)[number]) => o.scTipo === "SERVICIO";
  // Pendientes de cierre: servicios autorizados sin factura firmada y órdenes recibidas que abastecimiento no ha cerrado.
  const sinFactura = ocs.filter((o) => esServicio(o) && o.estado === "AUTORIZADA" && (veTodas || usuario.perfil === "JEFE_PLANIFICADOR" || o.solicitanteId === usuario.id));
  const sinCerrar = ocs.filter((o) => o.estado === "RECIBIDA_TOTAL" && !o.cerradaEn && (veTodas || o.solicitanteId === usuario.id));
  const sinOc = scs.filter((s) => s.estado === "APROBADA").length;
  const porAutorizar = ocs.filter((o) => o.estado === "EMITIDA").length;
  const porRecibir = ocs.filter((o) => !esServicio(o) && !o.cerradaEn && (o.estado === "AUTORIZADA" || o.estado === "RECIBIDA_PARCIAL")).length;
  const porComprar = propuesta.filter((p) => p.sugerida > 0).length;
  const numeros = [
    ["Presolicitudes por aprobar", porAprobar],
    ["Solicitudes con líneas por comprar", sinOc],
    ["Órdenes por autorizar", porAutorizar],
    ["Órdenes por recibir", porRecibir],
    ["Órdenes pendientes de cierre", sinFactura.length + sinCerrar.length],
  ] as const;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Compras</h1>
        <MenuCompras actual="/compras" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {numeros.map(([nombre, n]) => (
            <div key={nombre} className={tarjeta}>
              <p className="text-sm text-slate-600">{nombre}</p>
              <p className="text-2xl font-bold">{n}</p>
            </div>
          ))}
        </div>
        <Link href="/compras/verificar" className="text-marca underline">
          Verificar el código de una orden de compra impresa
        </Link>
        {porComprar > 0 && (
          <Link href="/compras/sc/nueva?propuesta=1" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base">
            <b>
              {porComprar === 1 ? "Hay 1 repuesto" : `Hay ${porComprar} repuestos`} bajo el stock mínimo sin compra en camino.
            </b>{" "}
            <span className="text-marca underline">Preparar una solicitud de compra con la propuesta</span>
          </Link>
        )}
        {sinFactura.length + sinCerrar.length > 0 && (
          <section className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <h2 className="text-lg font-bold">Pendientes de cierre</h2>
            {sinFactura.map((o) => (
              <Link key={o.id} href={`/compras/oc/${o.id}`} className="text-base">
                <b className="text-marca underline">{folioOc(o.id)}</b> · {o.proveedor} · servicio: falta que el jefe de área firme la factura del proveedor
              </Link>
            ))}
            {sinCerrar.map((o) => (
              <Link key={o.id} href={`/compras/oc/${o.id}`} className="text-base">
                <b className="text-marca underline">{folioOc(o.id)}</b> · {o.proveedor} ·{" "}
                {esServicio(o) ? "factura firmada" : "recibida completa"}: falta que abastecimiento cierre la orden
              </Link>
            ))}
          </section>
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
              <ChipOc estado={o.estado} cerrada={Boolean(o.cerradaEn)} />
            </Link>
          ))}
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Presolicitudes y solicitudes de compra</h2>
          <p className="text-sm text-slate-600">
            {veTodas ? "Ves todas las solicitudes." : "Ves las que pediste tú y las presolicitudes que te toca aprobar. Abastecimiento las ve todas."}
          </p>
          {scs.length === 0 && <p className="text-slate-600">No hay solicitudes de compra.</p>}
          {scs.map((s) => (
            <Link key={s.id} href={`/compras/sc/${s.id}`} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
              <span className="text-lg font-semibold">
                {folioDe(s)} · {s.origen === "STOCK_MINIMO" ? "Automática por stock mínimo" : s.solicitante}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {TIPOS_SC[s.tipo]}: {s.lineas.map((l) => l.descripcion).join(", ")} · {fechaHora(s.creadaEn)}
              </span>
              <ChipSc estado={s.estado} />
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
