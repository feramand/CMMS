import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/componentes/boton-imprimir";
import { ordenesCompra } from "@/db/schema";
import { folioOc, folioSc, ROLES_AUTORIZACION, ROLES_OBLIGATORIOS } from "@/lib/compras-core";
import { EMPRESA } from "@/lib/empresa";
import { listarOc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant, monto } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";

// Orden de compra lista para imprimir o guardar como PDF desde el navegador.
export default async function ImprimirOc({ params }: { params: Promise<{ id: string }> }) {
  await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [oc] = await listarOc(eq(ordenesCompra.id, id), 1);
  if (!oc) notFound();
  const autorizada = Boolean(oc.codigoVerificacion) && oc.estado !== "ANULADA" && oc.estado !== "RECHAZADA";
  const m = (n: number, dec = 2) => monto(n, oc.moneda, dec);
  const marca = oc.estado === "ANULADA" ? "ANULADA" : oc.estado === "RECHAZADA" ? "RECHAZADA" : autorizada ? null : "BORRADOR · NO AUTORIZADA";
  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-5 bg-white p-8 text-slate-900 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/compras/oc/${oc.id}`} className="text-marca underline">
          Volver
        </Link>
        <BotonImprimir texto="Imprimir o guardar como PDF" className="h-12 rounded-lg bg-marca px-4 font-semibold text-white" />
      </div>
      {marca && (
        <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-6xl font-black text-red-600/20 -rotate-30">
          {marca}
        </p>
      )}
      <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
        <div>
          <p className="text-2xl font-black">{EMPRESA.nombre}</p>
          {EMPRESA.rut && <p>RUT {EMPRESA.rut}</p>}
          {EMPRESA.giro && <p>{EMPRESA.giro}</p>}
          {EMPRESA.direccion && <p>{EMPRESA.direccion}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">Orden de compra {folioOc(oc.id)}</p>
          <p>Emitida el {fechaHora(oc.emitidaEn)}</p>
          {marca && <p className="font-bold text-red-700">{marca}</p>}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-4 text-base">
        <div>
          <p className="text-sm text-slate-600">Proveedor</p>
          <p className="font-semibold">{oc.proveedor}</p>
          {oc.proveedorRut && <p>RUT {oc.proveedorRut}</p>}
          {oc.proveedorDireccion && <p>{oc.proveedorDireccion}</p>}
          {oc.proveedorGiro && <p>{oc.proveedorGiro}</p>}
          {oc.proveedorContacto && <p>Contacto: {oc.proveedorContacto}</p>}
          {(oc.proveedorTelefono || oc.proveedorEmail) && <p>{[oc.proveedorTelefono, oc.proveedorEmail].filter(Boolean).join(" · ")}</p>}
        </div>
        <div>
          <p>
            <span className="text-slate-600">Moneda:</span> {oc.moneda}
          </p>
          <p>
            <span className="text-slate-600">Condición de pago:</span> {oc.condicionPago ?? "—"}
          </p>
          <p>
            <span className="text-slate-600">Entrega comprometida:</span> {oc.fechaEntrega ? oc.fechaEntrega.split("-").reverse().join("-") : "—"}
          </p>
          <p>
            <span className="text-slate-600">Emitida por:</span> {oc.emisor}
          </p>
          <p>
            <span className="text-slate-600">Solicitud de compra:</span> {folioSc(oc.scId)}
          </p>
          <p>
            <span className="text-slate-600">Cuenta contable:</span> {oc.cuenta ? `${oc.cuentaCodigo} · ${oc.cuenta}` : "—"}
          </p>
          <p>
            <span className="text-slate-600">Centro de costo:</span> {oc.centro ? `${oc.centroCodigo} · ${oc.centro}` : "—"}
          </p>
        </div>
      </section>
      <table className="w-full text-left text-base">
        <thead className="border-b border-slate-800 text-sm">
          <tr>
            <th className="py-1">Descripción</th>
            <th className="py-1 text-right">Cantidad</th>
            <th className="py-1 text-right">Precio neto</th>
            <th className="py-1 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {oc.lineas.map((l) => (
            <tr key={l.id} className="border-b border-slate-200">
              <td className="py-2">{l.descripcion}</td>
              <td className="py-2 text-right tabular-nums">{cant(l.cantidad)}</td>
              <td className="py-2 text-right tabular-nums">{m(l.precioUnitario, 4)}</td>
              <td className="py-2 text-right tabular-nums">{m(l.cantidad * l.precioUnitario)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-right font-semibold">
          <tr>
            <td colSpan={3} className="pt-2">
              Neto
            </td>
            <td className="pt-2 tabular-nums">{m(oc.neto)}</td>
          </tr>
          <tr>
            <td colSpan={3}>{oc.ivaExento ? "IVA (exenta)" : "IVA 19 %"}</td>
            <td className="tabular-nums">{m(oc.iva)}</td>
          </tr>
          <tr className="text-lg">
            <td colSpan={3}>Total</td>
            <td className="tabular-nums">{m(oc.total)}</td>
          </tr>
        </tfoot>
      </table>
      {oc.nota && (
        <p>
          <span className="text-slate-600">Observaciones:</span> {oc.nota}
        </p>
      )}
      <section className="mt-4 rounded-lg border-2 border-slate-800 p-4">
        <p className="font-bold">{autorizada ? "Autorizada" : "Autorizaciones"}</p>
        <div className="mt-2 grid grid-cols-3 gap-4">
          {(Object.keys(ROLES_AUTORIZACION) as (keyof typeof ROLES_AUTORIZACION)[]).map((rol) => {
            const a = oc.autorizaciones.find((x) => x.rol === rol);
            return (
              <div key={rol}>
                {/* Sin firma digital, el gerente general puede firmar a mano sobre la línea. */}
                {a ? (
                  <p className="font-semibold">{a.nombre}</p>
                ) : ROLES_OBLIGATORIOS.includes(rol) ? (
                  <p className="font-semibold">Pendiente</p>
                ) : (
                  <p className="mt-8 border-t border-slate-800 pt-1 text-sm">Firma</p>
                )}
                <p className="text-sm">{ROLES_AUTORIZACION[rol]}</p>
                {a && <p className="text-sm">{fechaHora(a.fecha)}</p>}
              </div>
            );
          })}
        </div>
        {autorizada && (
          <p className="mt-3 border-t border-slate-300 pt-2 text-sm">
            Código de verificación: <b className="tracking-widest">{oc.codigoVerificacion}</b>. Constancia interna de autorización emitida por
            el sistema de mantenimiento de {EMPRESA.nombre}; no es una firma electrónica avanzada.
          </p>
        )}
      </section>
    </main>
  );
}
