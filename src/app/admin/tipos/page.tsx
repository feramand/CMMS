import { asc, sql } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { tiposMaquina } from "@/db/schema";
import { exigirPerfil } from "@/lib/dal";
import { accionCrearTipo } from "./actions";

export default async function TiposDeMaquina({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const lista = await db
    .select({
      id: tiposMaquina.id,
      nombre: tiposMaquina.nombre,
      maquinas: sql<number>`(select count(*)::int from activos a where a.tipo_maquina_id = ${tiposMaquina.id})`,
      sistemas: sql<number>`(select count(*)::int from sistemas_tipo s where s.tipo_id = ${tiposMaquina.id})`,
    })
    .from(tiposMaquina)
    .orderBy(asc(tiposMaquina.nombre));
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Tipos de máquina · {lista.length}</h1>
          <Link href="/admin/activos" className="text-marca underline">
            Volver a activos
          </Link>
        </div>
        <p className="text-slate-700">
          Cada tipo tiene un árbol de sistemas que sirve de plantilla: las máquinas nuevas de ese tipo lo reciben
          completo y después se puede ajustar máquina por máquina.
        </p>
        <AvisoError mensaje={error} />
        <form action={accionCrearTipo} className={`${tarjeta} flex flex-wrap items-end gap-2`}>
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
            Nuevo tipo de máquina
            <input name="nombre" required maxLength={80} placeholder="Por ejemplo: Barnizadora UV" className={campo} />
          </label>
          <button type="submit" className={botonPrimario}>
            Crear tipo
          </button>
        </form>
        {lista.length === 0 && <p className="text-slate-600">Todavía no hay tipos de máquina.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {lista.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/tipos/${t.id}`} className={`${tarjeta} flex flex-col`}>
                <span className="text-lg font-semibold">{t.nombre}</span>
                <span className="text-sm text-slate-600">
                  {t.maquinas} {t.maquinas === 1 ? "máquina" : "máquinas"} · plantilla con {t.sistemas}{" "}
                  {t.sistemas === 1 ? "sistema" : "sistemas"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
