import Link from "next/link";
import { SugerenciasRepuestos } from "@/componentes/bodega";
import { MenuCompras } from "@/componentes/compras";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { gestionaCompras, propuestaDeCompra } from "@/lib/compras-core";
import { listarExistencias } from "@/lib/consultas-bodega";
import { listarCentros } from "@/lib/consultas-compras";
import { exigirPerfil } from "@/lib/dal";
import { cant } from "@/lib/formato";
import { accionCrearSc } from "../../actions";

const FILAS = 10;

export default async function NuevaSc({ searchParams }: { searchParams: Promise<{ error?: string; propuesta?: string }> }) {
  const usuario = await exigirPerfil("ABASTECIMIENTO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "BODEGUERO");
  const { error, propuesta } = await searchParams;
  const [catalogo, centros, sugeridas] = await Promise.all([listarExistencias(), listarCentros(), propuesta ? propuestaDeCompra(db) : []]);
  const previas = sugeridas.filter((p) => p.sugerida > 0);
  const filas = Array.from({ length: Math.max(FILAS, previas.length + 3) }, (_, i) => previas[i]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Nueva solicitud de compra</h1>
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
          <p className="text-sm text-slate-600">
            Al escribir aparecen los repuestos del catálogo. Si lo que necesitas no es un repuesto de bodega (un servicio, un
            insumo), descríbelo con tus palabras. Las filas vacías se ignoran.
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
            {gestionaCompras(usuario) ? "Crear solicitud (queda aprobada)" : "Enviar a abastecimiento"}
          </button>
        </form>
      </main>
    </>
  );
}
