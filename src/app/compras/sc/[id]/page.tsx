import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipSc, MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { ordenesCompra, solicitudesCompra } from "@/db/schema";
import { folioOc, folioSc, gestionaCompras, lineasConOc, MONEDAS, visaCompras } from "@/lib/compras-core";
import { listarExistencias } from "@/lib/consultas-bodega";
import { listarCentros, listarCuentas, listarProveedores, listarSc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import { accionCerrarSc, accionEmitirOc, accionResolverSc } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function Sc({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error } = await searchParams;
  const [[sc], ocs, proveedores, cuentas, centros, cubiertas] = await Promise.all([
    listarSc(eq(solicitudesCompra.id, id), 1),
    db.select({ id: ordenesCompra.id, estado: ordenesCompra.estado }).from(ordenesCompra).where(eq(ordenesCompra.scId, id)).orderBy(ordenesCompra.id),
    listarProveedores(),
    listarCuentas(),
    listarCentros(),
    lineasConOc(db, id),
  ]);
  if (!sc) notFound();
  const gestiona = gestionaCompras(usuario);
  const pendientes = sc ? sc.lineas.filter((l) => !cubiertas.has(l.id)) : [];
  const ids = sc.lineas.flatMap((l) => (l.repuestoId ? [l.repuestoId] : []));
  const repuestos = ids.length ? await listarExistencias({ ids, inactivos: true }) : [];
  const info = (repuestoId: number | null) => repuestos.find((r) => r.id === repuestoId);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Solicitud de compra {folioSc(sc.id)}</h1>
          <ChipSc estado={sc.estado} />
        </div>
        <MenuCompras actual="" />
        <AvisoError mensaje={error} />
        <section className={`${tarjeta} flex flex-col gap-4`}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Pidió">{sc.solicitante}</Dato>
            <Dato etiqueta="Fecha">{fechaHora(sc.creadaEn)}</Dato>
            <Dato etiqueta="Cuenta contable">{sc.cuenta ?? "—"}</Dato>
            <Dato etiqueta="Centro de costo">{sc.centro ?? "—"}</Dato>
            <div className="col-span-2 sm:col-span-4">
              <Dato etiqueta="Para qué es">{sc.nota ?? "—"}</Dato>
            </div>
          </div>
          {sc.motivoRechazo && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">Motivo del rechazo: {sc.motivoRechazo}</p>}
          {sc.cerradaEn && <p className="rounded-lg bg-slate-100 px-3 py-2">Abastecimiento cerró esta solicitud con líneas sin comprar.</p>}
          {ocs.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              Órdenes de compra de esta solicitud:
              {ocs.map((o) => (
                <Link key={o.id} href={`/compras/oc/${o.id}`} className="text-marca underline">
                  {folioOc(o.id)}
                  {o.estado === "ANULADA" ? " (anulada)" : o.estado === "RECHAZADA" ? " (rechazada)" : ""}
                </Link>
              ))}
            </p>
          )}
          <table className="w-full text-left text-base">
            <thead className="text-sm text-slate-600">
              <tr>
                <th className="py-1">Qué comprar</th>
                <th className="py-1 text-right">Cantidad</th>
                <th className="py-1 text-right">En existencia</th>
                <th className="py-1 text-right">Último costo medio</th>
                <th className="py-1 text-right">Orden de compra</th>
              </tr>
            </thead>
            <tbody>
              {sc.lineas.map((l) => {
                const r = info(l.repuestoId);
                return (
                  <tr key={l.id} className="border-t border-slate-200">
                    <td className="py-2">{l.descripcion}</td>
                    <td className="py-2 text-right tabular-nums">
                      {cant(l.cantidad)} {r?.unidad ?? ""}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r ? cant(r.total) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{r && r.costoMedio > 0 ? pesos(r.costoMedio) : "—"}</td>
                    <td className="py-2 text-right">
                      {cubiertas.has(l.id) ? (
                        <Link href={`/compras/oc/${cubiertas.get(l.id)}`} className="text-marca underline">
                          {folioOc(cubiertas.get(l.id)!)}
                        </Link>
                      ) : (
                        "Pendiente"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {!visaCompras(usuario) && sc.estado === "ENVIADA" && (
          <p className={tarjeta}>Esta solicitud espera el visto bueno del planificador o del jefe. Visada, pasa a abastecimiento.</p>
        )}
        {visaCompras(usuario) && sc.estado === "ENVIADA" && (
          <form action={accionResolverSc} className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Visar o rechazar</h2>
            <p className="text-sm text-slate-600">Al visarla queda liberada para que abastecimiento cotice y emita las órdenes de compra.</p>
            <input type="hidden" name="id" value={sc.id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Motivo (obligatorio para rechazar)
              <input name="motivo" className={campo} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button name="decision" value="aprobar" className={botonPrimario}>
                Visar
              </button>
              <button name="decision" value="rechazar" className="h-12 rounded-lg border-2 border-red-700 font-semibold text-red-700">
                Rechazar
              </button>
            </div>
          </form>
        )}

        {gestiona && sc.estado === "APROBADA" && (
          <form action={accionEmitirOc} className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Emitir orden de compra</h2>
            <p className="text-sm text-slate-600">
              Pon precio solo a las líneas que le compras a este proveedor. Las demás quedan pendientes para otra orden de compra de
              esta misma solicitud.
            </p>
            <input type="hidden" name="scId" value={sc.id} />
            {proveedores.filter((p) => p.activo).length === 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2">
                Primero crea el proveedor en{" "}
                <Link href="/compras/proveedores" className="text-marca underline">
                  Proveedores
                </Link>
                .
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Proveedor
                <select name="proveedorId" required defaultValue="" className={campo}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {proveedores
                    .filter((p) => p.activo)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Moneda
                <select name="moneda" defaultValue="CLP" className={campo}>
                  {Object.entries(MONEDAS).map(([valor, nombre]) => (
                    <option key={valor} value={valor}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Fecha de entrega comprometida (opcional)
                <input type="date" name="fechaEntrega" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Condición de pago (vacío: la del proveedor)
                <input name="condicionPago" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                N° de la cotización del proveedor (opcional)
                <input name="cotizacionRef" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Referencia (opcional)
                <input name="referencia" placeholder="Para qué es, factura proforma…" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Cuenta contable
                <select name="cuentaId" required defaultValue={sc.cuentaId ?? ""} className={campo}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {cuentas
                    .filter((c) => c.activo)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} · {c.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Centro de costo
                <select name="centroCostoId" required defaultValue={sc.centroCostoId ?? ""} className={campo}>
                  <option value="" disabled>
                    Elegir…
                  </option>
                  {centros
                    .filter((c) => c.activo)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} · {c.nombre}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-[1fr_6rem_9rem] items-center gap-2 text-sm font-semibold">
              <span>Línea</span>
              <span className="text-right">Cantidad</span>
              <span>Precio neto unitario</span>
              {pendientes.map((l) => (
                <div key={l.id} className="contents text-base font-normal">
                  <span>{l.descripcion}</span>
                  <span className="text-right tabular-nums">{cant(l.cantidad)}</span>
                  <input name={`p_${l.id}`} inputMode="decimal" aria-label={`Precio de ${l.descripcion}`} className={campo} />
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-600">Precios sin IVA, en la moneda elegida. El IVA (19 %) se calcula solo.</p>
            <label className="flex items-center gap-2 text-base">
              <input type="checkbox" name="ivaExento" className="size-5" />
              Compra exenta de IVA (IVA 0)
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Cotización del proveedor (opcional; PDF o foto, hasta 10 MB)
              <input type="file" name="cotizacion" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-base font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Observaciones para el proveedor (opcional)
              <input name="nota" className={campo} />
            </label>
            <button type="submit" className={botonPrimario}>
              Emitir orden de compra
            </button>
          </form>
        )}
        {gestiona && sc.estado === "APROBADA" && ocs.length > 0 && (
          <form action={accionCerrarSc} className={tarjeta}>
            <input type="hidden" name="id" value={sc.id} />
            <button className="font-semibold text-red-700 underline">Cerrar la solicitud: las líneas pendientes no se van a comprar</button>
          </form>
        )}
      </main>
    </>
  );
}
