import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SugerenciasRepuestos } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { Fotos } from "@/componentes/fotos";
import { AvisoError, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { adjuntos, solicitudesRepuesto } from "@/db/schema";
import { folioSc } from "@/lib/compras-core";
import { listarAlmacenes, listarExistencias, solicitudesPendientes } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { cant } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";
import { accionEntregarSolicitud, accionRechazarSolicitud } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function AtenderSolicitud({ params, searchParams }: Props) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { error } = await searchParams;
  const [[s], almacenes, catalogo, fotos] = await Promise.all([
    solicitudesPendientes(eq(solicitudesRepuesto.id, id)),
    listarAlmacenes(),
    listarExistencias(),
    db.select({ id: adjuntos.id }).from(adjuntos).where(eq(adjuntos.repuestoId, id)),
  ]);
  if (!s) notFound();
  const pedido = catalogo.find((r) => r.id === s.repuestoId);
  const falta = Math.round((s.cantidad - s.entregada) * 100) / 100;
  const conStock = pedido
    ? (almacenes.find((a) => (pedido.porAlmacen[a.id]?.cantidad ?? 0) >= falta) ?? almacenes.find((a) => (pedido.porAlmacen[a.id]?.cantidad ?? 0) > 0))
    : undefined;
  const hay = pedido && conStock ? (pedido.porAlmacen[conStock.id]?.cantidad ?? 0) : 0;
  const vuelta = usuario.perfil === "BODEGUERO" ? "/inicio" : "/bodega/solicitudes";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Solicitud de repuesto</h1>
          <Link href={vuelta} className="text-marca underline">
            Volver
          </Link>
        </div>
        <AvisoError mensaje={error} />
        <section className={`${tarjeta} flex flex-col gap-1`}>
          <span className="text-xl font-semibold">
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
          {s.entregada > 0 && (
            <span className="font-semibold">
              Ya entregado: {cant(s.entregada)} · falta {cant(falta)}
            </span>
          )}
          {s.scId && (
            <Link href={`/compras/sc/${s.scId}`} className="text-marca underline">
              Lo que falta está pedido en la solicitud de compra {folioSc(s.scId)}
            </Link>
          )}
          <Fotos ids={fotos.map((f) => f.id)} titulo="Fotos de referencia" />
        </section>
        {pedido && (
          <section className={`${tarjeta} flex flex-col gap-1`}>
            <span className="text-sm text-slate-600">Existencias de {pedido.codigo}</span>
            {almacenes.map((a) => (
              <span key={a.id} className="flex justify-between text-base">
                {a.nombre}
                <b>
                  {cant(pedido.porAlmacen[a.id]?.cantidad ?? 0)} {pedido.unidad}
                  {pedido.porAlmacen[a.id]?.ubicacion ? ` · ${pedido.porAlmacen[a.id].ubicacion}` : ""}
                </b>
              </span>
            ))}
          </section>
        )}
        <form action={accionEntregarSolicitud} className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Entregar</h2>
          <input type="hidden" name="id" value={s.id} />
          <label className="flex flex-col gap-1 text-base font-semibold">
            Repuesto del catálogo
            <input
              name="repuesto"
              list="catalogo"
              required
              autoComplete="off"
              defaultValue={pedido ? `${pedido.codigo} — ${pedido.descripcion}` : ""}
              placeholder="Escribe el código o parte de la descripción"
              className={`${campo} h-14 text-lg`}
            />
          </label>
          <SugerenciasRepuestos id="catalogo" repuestos={catalogo} />
          <label className="flex flex-col gap-1 text-base font-semibold">
            Sale de
            <select name="almacenId" required defaultValue={conStock?.id ?? almacenes[0]?.id} className={`${campo} h-14 text-lg`}>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Cantidad entregada
            <input name="cantidad" inputMode="decimal" defaultValue={pedido ? Math.min(falta, hay) || "" : falta} className={`${campo} h-14 text-lg`} />
          </label>
          {!s.scId && (
            <label className="flex items-center gap-3 text-base">
              <input type="checkbox" name="pedirResto" defaultChecked className="size-6" />
              Si entrego menos de lo pedido, mandar el resto a solicitud de compra
            </label>
          )}
          <p className="text-sm text-slate-600">
            La entrega descuenta existencias{s.folio ? ` y carga el costo a la OT ${s.folio}` : ""}. Se avisa a {s.solicitante}.
          </p>
          <button type="submit" name="decision" value="entregar" className="h-16 rounded-xl bg-green-700 text-xl font-bold text-white">
            Entregar
          </button>
          {!s.scId && (
            <button type="submit" name="decision" value="comprar" formNoValidate className="h-14 rounded-xl border-2 border-marca text-lg font-bold text-marca">
              No hay existencias: mandar todo a solicitud de compra
            </button>
          )}
        </form>
        <form action={accionRechazarSolicitud} className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">Rechazar</h2>
          <input type="hidden" name="id" value={s.id} />
          <label className="flex flex-col gap-1 text-base font-semibold">
            Motivo
            <input name="motivo" required placeholder="Sin existencias, no es de stock…" className={`${campo} h-14 text-lg`} />
          </label>
          <button type="submit" className="h-14 rounded-xl border-2 border-red-700 text-lg font-bold text-red-700">
            Rechazar solicitud
          </button>
        </form>
      </main>
    </>
  );
}
