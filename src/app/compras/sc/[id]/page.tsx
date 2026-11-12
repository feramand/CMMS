import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipSc, MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Dato, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { ordenesCompra, solicitudesCompra } from "@/db/schema";
import { folioOc, folioSc, gestionaCompras, MONEDAS } from "@/lib/compras-core";
import { listarExistencias } from "@/lib/consultas-bodega";
import { listarProveedores, listarSc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import { accionEmitirOc, accionResolverSc } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function Sc({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error } = await searchParams;
  const [[sc], ocs, proveedores] = await Promise.all([
    listarSc(eq(solicitudesCompra.id, id), 1),
    db.select({ id: ordenesCompra.id }).from(ordenesCompra).where(eq(ordenesCompra.scId, id)),
    listarProveedores(),
  ]);
  if (!sc) notFound();
  const gestiona = gestionaCompras(usuario);
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
            <Dato etiqueta="Centro de costo">{sc.centro ?? "—"}</Dato>
            <Dato etiqueta="Para qué es">{sc.nota ?? "—"}</Dato>
          </div>
          {sc.motivoRechazo && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">Motivo del rechazo: {sc.motivoRechazo}</p>}
          {ocs.map((o) => (
            <Link key={o.id} href={`/compras/oc/${o.id}`} className="text-marca underline">
              Ver la orden de compra {folioOc(o.id)}
            </Link>
          ))}
          <table className="w-full text-left text-base">
            <thead className="text-sm text-slate-600">
              <tr>
                <th className="py-1">Qué comprar</th>
                <th className="py-1 text-right">Cantidad</th>
                <th className="py-1 text-right">En existencia</th>
                <th className="py-1 text-right">Último costo medio</th>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {gestiona && sc.estado === "ENVIADA" && (
          <form action={accionResolverSc} className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">Aprobar o rechazar</h2>
            <input type="hidden" name="id" value={sc.id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Motivo (obligatorio para rechazar)
              <input name="motivo" className={campo} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button name="decision" value="aprobar" className={botonPrimario}>
                Aprobar
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
            </div>
            <div className="grid grid-cols-[1fr_6rem_9rem] items-center gap-2 text-sm font-semibold">
              <span>Línea</span>
              <span className="text-right">Cantidad</span>
              <span>Precio neto unitario</span>
              {sc.lineas.map((l) => (
                <div key={l.id} className="contents text-base font-normal">
                  <span>{l.descripcion}</span>
                  <span className="text-right tabular-nums">{cant(l.cantidad)}</span>
                  <input name={`p_${l.id}`} inputMode="decimal" aria-label={`Precio de ${l.descripcion}`} className={campo} />
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-600">
              Precios sin IVA, en la moneda elegida. Una línea sin precio no entra en la orden. El IVA (19 %) se calcula solo.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Observaciones para el proveedor (opcional)
              <input name="nota" className={campo} />
            </label>
            <button type="submit" className={botonPrimario}>
              Emitir orden de compra
            </button>
          </form>
        )}
      </main>
    </>
  );
}
