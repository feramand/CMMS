import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { MenuBodega } from "@/componentes/bodega";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Chip, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { almacenes, tomasInventario, usuarios } from "@/db/schema";
import { operaBodega } from "@/lib/bodega-core";
import { listarAlmacenes } from "@/lib/consultas-bodega";
import { exigirPerfil } from "@/lib/dal";
import { fechaHora } from "@/lib/tiempo";
import { accionAbrirToma } from "../actions";

const ESTADO = { ABIERTA: ["En conteo", "ambar"], CERRADA: ["Cerrado", "verde"], ANULADA: ["Anulado", "gris"] } as const;

export default async function Inventarios({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("BODEGUERO", "ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const { error } = await searchParams;
  const opera = operaBodega(usuario);
  const [lista, tomas] = await Promise.all([
    listarAlmacenes(),
    db
      .select({ id: tomasInventario.id, estado: tomasInventario.estado, creadaEn: tomasInventario.creadaEn, cerradaEn: tomasInventario.cerradaEn, almacen: almacenes.nombre, quien: usuarios.nombre })
      .from(tomasInventario)
      .innerJoin(almacenes, eq(almacenes.id, tomasInventario.almacenId))
      .innerJoin(usuarios, eq(usuarios.id, tomasInventario.creadaPor))
      .orderBy(desc(tomasInventario.id))
      .limit(100),
  ]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Inventarios</h1>
        <MenuBodega actual="/bodega/inventarios" opera={opera} />
        <AvisoError mensaje={error} />
        {opera && (
          <form action={accionAbrirToma} className={`${tarjeta} grid items-end gap-3 sm:grid-cols-[1fr_auto]`}>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Abrir un conteo físico en
              <select name="almacenId" required className={campo}>
                {lista.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={botonPrimario}>
              Abrir inventario
            </button>
          </form>
        )}
        <p className="text-sm text-slate-600">
          Se cuenta lo que hay, se escribe en pantalla y al cerrar el sistema ajusta las diferencias. Se puede contar todo el almacén
          o solo una parte: lo que no se cuenta no se toca.
        </p>
        {tomas.length === 0 && <p className="text-slate-600">Todavía no se ha hecho ningún inventario.</p>}
        {tomas.map((t) => (
          <Link key={t.id} href={`/bodega/inventarios/${t.id}`} className={`${tarjeta} flex flex-wrap items-center justify-between gap-3`}>
            <span className="text-lg font-semibold">
              N.º {t.id} · {t.almacen}
            </span>
            <span className="text-slate-700">
              Abierto {fechaHora(t.creadaEn)} por {t.quien}
              {t.cerradaEn ? ` · cerrado ${fechaHora(t.cerradaEn)}` : ""}
            </span>
            <Chip tono={ESTADO[t.estado][1]}>{ESTADO[t.estado][0]}</Chip>
          </Link>
        ))}
      </main>
    </>
  );
}
