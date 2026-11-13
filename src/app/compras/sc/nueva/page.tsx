import Link from "next/link";
import { SugerenciasRepuestos } from "@/componentes/bodega";
import { MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { propuestaDeCompra, TIPOS_SC, visaCompras } from "@/lib/compras-core";
import { listarExistencias } from "@/lib/consultas-bodega";
import { listarCentros, listarCuentas } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant } from "@/lib/formato";
import { accionCrearSc } from "../../actions";

const FILAS = 10;

export default async function NuevaSc({ searchParams }: { searchParams: Promise<{ error?: string; propuesta?: string }> }) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const { error, propuesta } = await searchParams;
  const [catalogo, centros, cuentas, sugeridas] = await Promise.all([listarExistencias(), listarCentros(), listarCuentas(), propuesta ? propuestaDeCompra(db) : []]);
  const previas = sugeridas.filter((p) => p.sugerida > 0);
  const filas = Array.from({ length: Math.max(FILAS, previas.length + 3) }, (_, i) => previas[i]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Nueva presolicitud de compra</h1>
        <MenuCompras actual="/compras/sc/nueva" />
        <AvisoError mensaje={error} />
        {propuesta ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-base">
            {previas.length === 0
              ? "No hay repuestos bajo el mínimo sin compra en camino."
              : "Propuesta: repuestos bajo el stock mínimo. La cantidad lleva el total hasta el stock máximo (o hasta el mínimo, si no tiene máximo), menos lo que ya viene en camino. Puedes cambiar o borrar cualquier línea."}
          </p>
        ) : (
          <Link href="/compras/sc/nueva?propuesta=1" className="text-marca underline">
            Llenar con los repuestos que están bajo el stock mínimo
          </Link>
        )}
        <form action={accionCrearSc} className={`${tarjeta} flex flex-col gap-3`}>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Tipo de solicitud
            <select name="tipo" required defaultValue="INVENTARIO" className={campo}>
              {Object.entries(TIPOS_SC).map(([valor, nombre]) => (
                <option key={valor} value={valor}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate-600">
            Con código de inventario: elige los repuestos de las sugerencias que aparecen al escribir (puedes agregar una línea
            anexa escrita a mano, como un flete). Sin código o servicios: describe lo que necesitas con tus palabras; ahí no van
            repuestos del catálogo. Las filas vacías se ignoran.
          </p>
          <div className="grid grid-cols-[1fr_7rem] gap-2 text-sm font-semibold">
            <span>Qué comprar</span>
            <span>Cantidad</span>
            {filas.map((p, i) => (
              <div key={i} className="contents">
                <input
                  name="item"
                  list="catalogo"
                  autoComplete="off"
                  aria-label={`Línea ${i + 1}`}
                  defaultValue={p ? `${p.codigo} — ${p.descripcion}` : ""}
                  className={`${campo} font-normal`}
                />
                <input name="cantidad" inputMode="decimal" aria-label={`Cantidad ${i + 1}`} defaultValue={p ? cant(p.sugerida) : ""} className={`${campo} font-normal`} />
              </div>
            ))}
          </div>
          <SugerenciasRepuestos id="catalogo" repuestos={catalogo} />
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Cuenta contable (opcional)
            <select name="cuentaId" defaultValue="" className={campo}>
              <option value="">—</option>
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
            Centro de costo (opcional)
            <select name="centroCostoId" defaultValue="" className={campo}>
              <option value="">—</option>
              {centros
                .filter((c) => c.activo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nombre}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Para qué es (opcional)
            <input name="nota" className={campo} />
          </label>
          <button type="submit" className={botonPrimario}>
            {visaCompras(usuario) ? "Crear solicitud (queda aprobada y pasa a abastecimiento)" : "Enviar presolicitud para aprobar"}
          </button>
        </form>
      </main>
    </>
  );
}
