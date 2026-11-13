import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { MenuBodega } from "@/componentes/bodega";
import { botonPrimario, botonSecundario, campo, Chip, tarjeta } from "@/componentes/ui";
import { operaBodega } from "@/lib/bodega-core";
import { listarAlmacenes, listarExistencias } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { cant, pesos } from "@/lib/formato";

type Props = { searchParams: Promise<{ q?: string; almacen?: string; ver?: string }> };

export default async function Existencias({ searchParams }: Props) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const { q, almacen, ver } = await searchParams;
  const almacenId = Number(almacen) || null;
  const [almacenes, todos] = await Promise.all([listarAlmacenes(), listarExistencias({ texto: q, inactivos: ver === "baja" })]);
  const enAlmacen = (r: (typeof todos)[number]) => (almacenId ? (r.porAlmacen[almacenId]?.cantidad ?? 0) : r.total);
  const filas = todos.filter((r) => {
    if (ver === "baja") return !r.activo;
    if (ver === "minimo") return r.stockMinimo > 0 && r.total < r.stockMinimo;
    if (ver === "cero") return enAlmacen(r) === 0;
    if (almacenId && ver !== "todo") return r.porAlmacen[almacenId] !== undefined;
    return true;
  });
  const bajoMinimo = todos.filter((r) => r.activo && r.stockMinimo > 0 && r.total < r.stockMinimo).length;
  const valor = filas.reduce((s, r) => s + enAlmacen(r) * r.costoMedio, 0);
  const visibles = almacenId ? almacenes.filter((a) => a.id === almacenId) : almacenes;
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Bodega</h1>
          {(operaBodega(usuario) || usuario.perfil === "ABASTECIMIENTO") && (
            <Link href="/bodega/nuevo" className={botonPrimario}>
              Nuevo repuesto
            </Link>
          )}
        </div>
        <MenuBodega actual="/bodega" opera={operaBodega(usuario)} />
        <form className={`${tarjeta} grid items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto]`}>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Buscar por código interno, código de fabricante, marca, descripción o familia
            <input name="q" defaultValue={q ?? ""} className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Almacén
            <select name="almacen" defaultValue={almacen ?? ""} className={campo}>
              <option value="">Todos</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Mostrar
            <select name="ver" defaultValue={ver ?? ""} className={campo}>
              <option value="">Vigentes</option>
              <option value="minimo">Bajo el stock mínimo</option>
              <option value="cero">Sin existencias</option>
              <option value="baja">Dados de baja</option>
            </select>
          </label>
          <button type="submit" className={botonSecundario}>
            Filtrar
          </button>
        </form>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Repuestos en la lista</p>
            <p className="text-2xl font-bold">{filas.length.toLocaleString("es-CL")}</p>
          </div>
          <div className={tarjeta}>
            <p className="text-sm text-slate-600">Valor de las existencias en la lista</p>
            <p className="text-2xl font-bold">{pesos(valor)}</p>
          </div>
          <Link href="/bodega?ver=minimo" className={tarjeta}>
            <p className="text-sm text-slate-600">Bajo el stock mínimo</p>
            <p className={`text-2xl font-bold ${bajoMinimo ? "text-red-700" : ""}`}>{bajoMinimo}</p>
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-base">
            <thead className="bg-slate-100 text-sm text-slate-700">
              <tr>
                <th className="px-3 py-2">Código interno</th>
                <th className="px-3 py-2">Código fabricante</th>
                <th className="px-3 py-2">Marca</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Ubicación</th>
                {visibles.map((a) => (
                  <th key={a.id} className="px-3 py-2 text-right">
                    {a.nombre}
                  </th>
                ))}
                {!almacenId && <th className="px-3 py-2 text-right">Total</th>}
                <th className="px-3 py-2 text-right">Mínimo</th>
                <th className="px-3 py-2 text-right">Costo medio</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 500).map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/bodega/repuesto/${r.id}`} className="text-marca underline">
                      {r.codigo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.codigoFabricante ?? "—"}</td>
                  <td className="px-3 py-2">{r.marca ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.descripcion}
                    {r.familia && <span className="text-sm text-slate-500"> · {r.familia}</span>}
                    {r.activo && r.stockMinimo > 0 && r.total < r.stockMinimo && (
                      <span className="ml-2">
                        <Chip tono="rojo">Bajo mínimo</Chip>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {visibles.filter((a) => r.porAlmacen[a.id]?.ubicacion).length === 0
                      ? "—"
                      : visibles
                          .filter((a) => r.porAlmacen[a.id]?.ubicacion)
                          .map((a) => (
                            <span key={a.id} className="block whitespace-nowrap">
                              {visibles.length > 1 && <span className="text-slate-500">{a.nombre}: </span>}
                              {r.porAlmacen[a.id].ubicacion}
                            </span>
                          ))}
                  </td>
                  {visibles.map((a) => (
                    <td key={a.id} className="px-3 py-2 text-right tabular-nums">
                      {cant(r.porAlmacen[a.id]?.cantidad ?? 0)}
                    </td>
                  ))}
                  {!almacenId && (
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {cant(r.total)} <span className="text-xs font-normal text-slate-500">{r.unidad}</span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums">{r.stockMinimo ? cant(r.stockMinimo) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pesos(r.costoMedio)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pesos(enAlmacen(r) * r.costoMedio)}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-slate-600">
                    {todos.length === 0 && !q ? "El catálogo está vacío. Crea un repuesto o carga la planilla." : "Ningún repuesto coincide con el filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filas.length > 500 && <p className="text-sm text-slate-600">Se muestran los primeros 500. Usa el buscador para acotar.</p>}
      </main>
    </>
  );
}
