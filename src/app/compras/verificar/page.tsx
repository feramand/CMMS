import { sql } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { botonPrimario, campo, Chip, Dato, tarjeta } from "@/componentes/ui";
import { ordenesCompra } from "@/db/schema";
import { folioOc, ROLES_AUTORIZACION } from "@/lib/compras-core";
import { listarOc } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { monto } from "@/lib/formato";
import { fechaHora } from "@/lib/tiempo";

// Comprueba que una orden de compra impresa es auténtica: el código solo existe si la orden fue autorizada.
export default async function VerificarOc({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const codigo = ((await searchParams).codigo ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 32);
  const [oc] = codigo ? await listarOc(sql`upper(${ordenesCompra.codigoVerificacion}) = ${codigo}`, 1) : [];
  const vigente = oc && oc.estado !== "ANULADA" && oc.estado !== "RECHAZADA";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Verificar una orden de compra</h1>
          <Link href="/compras" className="text-marca underline">
            Volver a compras
          </Link>
        </div>
        <form className={`${tarjeta} flex flex-wrap items-end gap-3`}>
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
            Código de verificación impreso en la orden
            <input name="codigo" required defaultValue={codigo} autoCapitalize="none" autoComplete="off" className={`${campo} tracking-widest`} />
          </label>
          <button type="submit" className={botonPrimario}>
            Verificar
          </button>
        </form>
        {codigo && !oc && (
          <p role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-base text-red-800">
            Ninguna orden de compra tiene ese código. Revisa que esté bien escrito; si lo está, el documento no fue autorizado en el sistema.
          </p>
        )}
        {oc && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                <Link href={`/compras/oc/${oc.id}`} className="text-marca underline">
                  {folioOc(oc.id)}
                </Link>
              </h2>
              {vigente ? <Chip tono="verde">Auténtica y vigente</Chip> : <Chip tono="rojo">{oc.estado === "ANULADA" ? "Anulada" : "Rechazada"}: ya no vale</Chip>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Dato etiqueta="Proveedor">{oc.proveedor}</Dato>
              <Dato etiqueta="RUT del proveedor">{oc.proveedorRut}</Dato>
              <Dato etiqueta="Emitida">{fechaHora(oc.emitidaEn)}</Dato>
              <Dato etiqueta={oc.ivaExento ? "Total (exenta de IVA)" : "Total con IVA"}>{monto(oc.total, oc.moneda, oc.moneda === "CLP" ? 0 : 2)}</Dato>
            </div>
            <ul className="flex flex-col gap-1">
              {oc.autorizaciones.map((a) => (
                <li key={a.rol} className="border-t border-slate-200 pt-1">
                  {ROLES_AUTORIZACION[a.rol]}: <b>{a.nombre}</b> · {fechaHora(a.fecha)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-600">Compara el proveedor y el total con los del documento impreso: deben ser iguales.</p>
          </section>
        )}
      </main>
    </>
  );
}
