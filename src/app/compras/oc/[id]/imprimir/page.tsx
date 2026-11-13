import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/componentes/boton-imprimir";
import { ordenesCompra } from "@/db/schema";
import { folioOc, folioSc, MONEDAS, ROLES_AUTORIZACION, ROLES_OBLIGATORIOS } from "@/lib/compras-core";
import { listarOc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { EMPRESA } from "@/lib/empresa";
import { cant, monto } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";

const fecha = (iso: string) => iso.split("-").reverse().join("-");

function Par({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-700">{nombre}:</dt>
      <dd>{children || "—"}</dd>
    </>
  );
}

// Orden de compra con el formato de la empresa, lista para imprimir o guardar como PDF desde el navegador.
export default async function ImprimirOc({ params }: { params: Promise<{ id: string }> }) {
  await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [oc] = await listarOc(eq(ordenesCompra.id, id), 1);
  if (!oc) notFound();
  const autorizada = Boolean(oc.codigoVerificacion) && oc.estado !== "ANULADA" && oc.estado !== "RECHAZADA";
  const m = (n: number, dec = 2) => monto(n, oc.moneda, dec);
  const marca = oc.estado === "ANULADA" ? "ANULADA" : oc.estado === "RECHAZADA" ? "RECHAZADA" : autorizada ? null : "BORRADOR · NO AUTORIZADA";
  const celda = "border border-slate-800 px-2 py-1";
  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-4 bg-white p-8 text-sm text-slate-900 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/compras/oc/${oc.id}`} className="text-base text-marca underline">
          Volver
        </Link>
        <BotonImprimir texto="Imprimir o guardar como PDF" className="h-12 rounded-lg bg-marca px-4 text-base font-semibold text-white" />
      </div>
      {marca && (
        <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-6xl font-black text-red-600/20 -rotate-30">
          {marca}
        </p>
      )}
      <header className="relative text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {EMPRESA.logo && <img src="/logo-empresa" alt="" className="absolute top-0 left-0 h-16" />}
        <p className="text-xl font-semibold">{EMPRESA.nombre}</p>
        {EMPRESA.direccion && <p>{EMPRESA.direccion}</p>}
        {EMPRESA.fono && <p>Fono: {EMPRESA.fono}</p>}
        <h1 className="mt-2 text-2xl">Orden de Compra N° {folioOc(oc.id)}</h1>
        {marca && <p className="font-bold text-red-700">{marca}</p>}
      </header>
      <section className="grid grid-cols-[3fr_2fr] gap-6">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
          <Par nombre="Señores">{oc.proveedor}</Par>
          <Par nombre="Dirección">{oc.proveedorDireccion}</Par>
          <Par nombre="Atn. Sr.">{oc.proveedorContacto}</Par>
          <Par nombre="E-mail">{oc.proveedorEmail}</Par>
          <Par nombre="Su cotización">{oc.cotizacionRef}</Par>
          <Par nombre="Referencia">{oc.referencia}</Par>
        </dl>
        <dl className="grid grid-cols-[5rem_1fr] content-start gap-x-2 gap-y-0.5">
          <Par nombre="RUT">{oc.proveedorRut}</Par>
          <Par nombre="Fono">{oc.proveedorTelefono}</Par>
          <Par nombre="Fecha">{fechaHora(oc.emitidaEn).split(",")[0]}</Par>
          <Par nombre="Moneda">{MONEDAS[oc.moneda]}</Par>
        </dl>
      </section>
      <div>
        <p className="font-bold">Solicitamos realizar lo siguiente:</p>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-center">
              <th className={celda}>Código interno</th>
              <th className={celda}>Cant.</th>
              <th className={celda}>Unidad</th>
              <th className={celda}>Descripción</th>
              <th className={celda}>Número de parte</th>
              <th className={celda}>V. unit.</th>
              <th className={celda}>V. total</th>
            </tr>
          </thead>
          <tbody>
            {oc.lineas.map((l) => (
              <tr key={l.id}>
                <td className={celda}>{l.codigo ?? ""}</td>
                <td className={`${celda} text-right tabular-nums`}>{cant(l.cantidad)}</td>
                <td className={`${celda} text-center`}>{l.unidad ?? ""}</td>
                <td className={celda}>{l.nombreRepuesto ?? l.descripcion}</td>
                <td className={celda}>{l.numeroParte ?? ""}</td>
                <td className={`${celda} text-right tabular-nums whitespace-nowrap`}>{m(l.precioUnitario, 4)}</td>
                <td className={`${celda} text-right tabular-nums whitespace-nowrap`}>{m(l.cantidad * l.precioUnitario)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="grid grid-cols-[3fr_2fr] items-start gap-6">
        <div className="flex flex-col">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5 border border-slate-800 p-2">
            <Par nombre="Fecha entrega">{oc.fechaEntrega ? fecha(oc.fechaEntrega) : ""}</Par>
            <Par nombre="Forma de pago">{oc.condicionPago}</Par>
            {oc.tipo === "IMPORTACION" && <Par nombre="Incoterm">{oc.incoterm}</Par>}
            {oc.tipo === "IMPORTACION" && <Par nombre="Vía de embarque">{oc.viaEmbarque}</Par>}
          </dl>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5 border border-t-0 border-slate-800 p-2">
            <Par nombre="Solicita">{oc.solicita}</Par>
            <Par nombre="Solicitud">{folioSc(oc.scId)}</Par>
            <Par nombre="Cuenta contable">{oc.cuenta ? `${oc.cuentaCodigo} · ${oc.cuenta}` : ""}</Par>
            <Par nombre="C. costo">{oc.centro ? `${oc.centroCodigo} · ${oc.centro}` : ""}</Par>
          </dl>
        </div>
        <table className="w-full text-right">
          <tbody>
            <tr>
              <td className="py-0.5">Neto</td>
              <td className="py-0.5 font-semibold tabular-nums">{m(oc.neto)}</td>
            </tr>
            <tr>
              <td className="py-0.5">{oc.ivaExento ? "IVA (exenta)" : "IVA 19 %"}</td>
              <td className="py-0.5 font-semibold tabular-nums">{m(oc.iva)}</td>
            </tr>
            <tr className="border-t-2 border-slate-800 text-base">
              <td className="py-1">Total</td>
              <td className="py-1 font-bold tabular-nums">{m(oc.total)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p>
        <b>Notas:</b> {EMPRESA.nota}
        {oc.nota ? ` ${oc.nota}` : ""}
      </p>
      <section className="flex items-end justify-between">
        <p>
          <b>Informarse con:</b> {oc.emisor}
          <br />
          <b>E-mail:</b> {oc.emisorEmail ?? "—"}
        </p>
        <p className="text-center">
          pp. {EMPRESA.nombre.toUpperCase()}
          {EMPRESA.rut && (
            <>
              <br />
              <b>RUT: {EMPRESA.rut}</b>
            </>
          )}
        </p>
      </section>
      <section className="rounded-lg border-2 border-slate-800 p-3">
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
                  <p className="mt-8 border-t border-slate-800 pt-1">Firma</p>
                )}
                <p>{ROLES_AUTORIZACION[rol]}</p>
                {a && <p>{fechaHora(a.fecha)}</p>}
              </div>
            );
          })}
        </div>
        {autorizada && (
          <p className="mt-3 border-t border-slate-300 pt-2">
            Código de verificación: <b className="tracking-widest">{oc.codigoVerificacion}</b>. Constancia interna de autorización emitida por
            el sistema de mantenimiento de {EMPRESA.nombre}; no es una firma electrónica avanzada.
          </p>
        )}
      </section>
    </main>
  );
}
