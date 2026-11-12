import { and, eq, gte, lt, type SQL } from "drizzle-orm";
import Link from "next/link";
import { MenuBodega } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { movimientos, tipoMovimientoEnum, type TipoMovimiento } from "@/db/schema";
import { operaBodega, TIPOS_MOVIMIENTO } from "@/lib/bodega-core";
import { listarMovimientos } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";
import { fechaHora, inicioDelDiaEnChile, partesEnChile } from "@/lib/tiempo";

type Props = { searchParams: Promise<{ tipo?: string; desde?: string; hasta?: string }> };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function Movimientos({ searchParams }: Props) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const p = await searchParams;
  const hoy = partesEnChile(new Date()).fecha;
  const desde = FECHA.test(p.desde ?? "") ? (p.desde as string) : `${hoy.slice(0, 8)}01`;
  const hasta = FECHA.test(p.hasta ?? "") ? (p.hasta as string) : hoy;
  const tipo = tipoMovimientoEnum.enumValues.includes(p.tipo as TipoMovimiento) ? (p.tipo as TipoMovimiento) : null;
  const fin = new Date(inicioDelDiaEnChile(hasta).getTime() + 24 * 3_600_000);
  const filtros: SQL[] = [gte(movimientos.fecha, inicioDelDiaEnChile(desde)), lt(movimientos.fecha, fin)];
  if (tipo) filtros.push(eq(movimientos.tipo, tipo));
  const movs = await listarMovimientos(and(...filtros), 1000);
  const total = (t: TipoMovimiento) => movs.filter((m) => m.tipo === t).reduce((s, m) => s + Math.abs(m.cantidad) * m.costoUnitario, 0);
  const consumo = total("SALIDA") - total("DEVOLUCION");
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Movimientos de bodega</h1>
        <MenuBodega actual="/bodega/movimientos" opera={operaBodega(usuario)} />
        <form className={`${tarjeta} grid items-end gap-3 sm:grid-cols-4`}>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Desde
            <input type="date" name="desde" defaultValue={desde} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Hasta
            <input type="date" name="hasta" defaultValue={hasta} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Tipo
            <select name="tipo" defaultValue={tipo ?? ""} className={campo}>
              <option value="">Todos</option>
              {tipoMovimientoEnum.enumValues.map((t) => (
                <option key={t} value={t}>
                  {TIPOS_MOVIMIENTO[t]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={botonSecundario}>
            Filtrar
          </button>
        </form>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Movimientos en el período</p>
            <p className="text-2xl font-bold">{movs.length.toLocaleString("es-CL")}</p>
          </div>
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Entradas valorizadas</p>
            <p className="text-2xl font-bold">{pesos(total("ENTRADA"))}</p>
          </div>
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Consumo (entregas menos devoluciones)</p>
            <p className="text-2xl font-bold">{pesos(consumo)}</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-base">
            <thead className="bg-slate-100 text-sm text-slate-700">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Repuesto</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Almacén</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id} className="border-t border-slate-200 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fechaHora(m.fecha)}</td>
                  <td className="px-3 py-2 font-semibold">{TIPOS_MOVIMIENTO[m.tipo]}</td>
                  <td className="px-3 py-2">
                    <Link href={`/bodega/repuesto/${m.repuestoId}`} className="font-semibold text-marca underline">
                      {m.codigo}
                    </Link>{" "}
                    {m.descripcion}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                    {m.tipo === "TRASLADO" ? cant(m.cantidad) : `${m.cantidad > 0 ? "+" : "−"}${cant(Math.abs(m.cantidad))}`} {m.unidad}
                  </td>
                  <td className="px-3 py-2">
                    {m.almacen}
                    {m.destino ? ` → ${m.destino}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pesos(Math.abs(m.cantidad) * m.costoUnitario)}</td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    {[m.folio ? `OT ${m.folio}` : null, m.activo, m.recibe ? `recibe ${m.recibe}` : null, m.documento, m.nota, `por ${m.usuario}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
              {movs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-600">
                    Sin movimientos en el período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {movs.length === 1000 && <p className="text-sm text-slate-600">Se muestran los 1.000 más recientes. Acota las fechas para ver el resto.</p>}
      </main>
    </>
  );
}
