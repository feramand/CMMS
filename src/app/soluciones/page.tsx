import { and, asc, desc, eq, ilike, isNotNull, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { botonPrimario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, ordenesTrabajo, sectores, solicitudes, usuarios } from "@/db/schema";
import { nombreCategoria } from "@/lib/categorias";
import { exigirPerfil } from "@/lib/dal";
import { rutaInicio } from "@/lib/perfiles";
import { fechaHora } from "@/lib/tiempo";

const LIMITE = 100;

type Caso = {
  clave: string;
  href: string;
  titulo: string;
  fecha: Date | null;
  activo: string;
  sistema: string | null;
  problema: string | null;
  causa: string | null;
  solucion: string | null;
  acciones: string | null;
  quien: string | null;
};

// Base de soluciones: lo que ya se hizo ante cada falla, para consultarlo antes de volver a diagnosticar.
export default async function Soluciones({ searchParams }: { searchParams: Promise<{ q?: string; activoId?: string }> }) {
  const usuario = await exigirPerfil("TECNICO", "JEFE_PLANIFICADOR", "ADMINISTRADOR");
  const pedido = await searchParams;
  const q = (pedido.q ?? "").trim().slice(0, 80);
  const activoId = Number(pedido.activoId);
  const porMaquina = Number.isInteger(activoId) && activoId > 0;
  const patron = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const contiene = (...columnas: Parameters<typeof ilike>[0][]): SQL | undefined => (q ? or(...columnas.map((c) => ilike(c, patron))) : undefined);

  const [maquinas, directas, conOrden] = await Promise.all([
    db.select({ id: activos.id, nombre: activos.nombre }).from(activos).orderBy(asc(activos.nombre)),
    // Solicitudes que el técnico solucionó sin orden de trabajo.
    db
      .select({
        id: solicitudes.id,
        fecha: solicitudes.cerradaEn,
        activo: activos.nombre,
        sistema: sectores.nombre,
        categoria: solicitudes.categoria,
        origenReal: solicitudes.origenReal,
        problema: solicitudes.comentario,
        solucion: solicitudes.solucion,
        quien: usuarios.nombre,
      })
      .from(solicitudes)
      .innerJoin(activos, eq(activos.id, solicitudes.activoId))
      .leftJoin(sectores, eq(sectores.id, solicitudes.sectorId))
      .leftJoin(usuarios, eq(usuarios.id, solicitudes.responsableId))
      .where(
        and(
          eq(solicitudes.estado, "SOLUCIONADA"),
          isNotNull(solicitudes.solucion),
          porMaquina ? eq(solicitudes.activoId, activoId) : undefined,
          contiene(solicitudes.comentario, solicitudes.solucion, sectores.nombre, activos.nombre),
        ),
      )
      .orderBy(desc(solicitudes.cerradaEn))
      .limit(LIMITE),
    // Órdenes de trabajo finalizadas que dejaron observaciones o análisis de causa raíz.
    db
      .select({
        id: ordenesTrabajo.id,
        folio: ordenesTrabajo.folio,
        fecha: ordenesTrabajo.terminoEn,
        activo: activos.nombre,
        problema: ordenesTrabajo.descripcion,
        observaciones: ordenesTrabajo.observaciones,
        causa: ordenesTrabajo.rcaCausa,
        solucion: ordenesTrabajo.rcaSolucion,
        acciones: ordenesTrabajo.rcaAcciones,
        quien: usuarios.nombre,
      })
      .from(ordenesTrabajo)
      .innerJoin(activos, eq(activos.id, ordenesTrabajo.activoId))
      .leftJoin(usuarios, eq(usuarios.id, ordenesTrabajo.responsableId))
      .where(
        and(
          eq(ordenesTrabajo.estado, "FINALIZADA"),
          or(isNotNull(ordenesTrabajo.observaciones), isNotNull(ordenesTrabajo.rcaSolucion), isNotNull(ordenesTrabajo.rcaCausa)),
          porMaquina ? eq(ordenesTrabajo.activoId, activoId) : undefined,
          contiene(ordenesTrabajo.descripcion, ordenesTrabajo.observaciones, ordenesTrabajo.rcaCausa, ordenesTrabajo.rcaSolucion, ordenesTrabajo.rcaAcciones, activos.nombre),
        ),
      )
      .orderBy(desc(ordenesTrabajo.terminoEn))
      .limit(LIMITE),
  ]);
  const casos: Caso[] = [
    ...directas.map((s) => ({
      clave: `s${s.id}`,
      href: `/sat/${s.id}`,
      titulo: `Solicitud · ${nombreCategoria(s.origenReal ?? s.categoria)}`,
      fecha: s.fecha,
      activo: s.activo,
      sistema: s.sistema,
      problema: s.problema,
      causa: null,
      solucion: s.solucion,
      acciones: null,
      quien: s.quien,
    })),
    ...conOrden.map((o) => ({
      clave: `o${o.id}`,
      href: `/ot/${o.id}`,
      titulo: `Orden de trabajo ${o.folio}`,
      fecha: o.fecha,
      activo: o.activo,
      sistema: null,
      problema: o.problema,
      causa: o.causa,
      solucion: o.solucion ?? o.observaciones,
      acciones: o.acciones,
      quien: o.quien,
    })),
  ]
    .sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0))
    .slice(0, LIMITE);

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Base de soluciones</h1>
          <Link href={rutaInicio(usuario.perfil)} className="text-marca underline">
            Volver
          </Link>
        </div>
        <form className={`${tarjeta} flex flex-col gap-3 sm:flex-row sm:items-end`}>
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
            Máquina
            <select name="activoId" defaultValue={porMaquina ? activoId : ""} className={campo}>
              <option value="">Todas</option>
              {maquinas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
            Buscar (falla, sistema o solución)
            <input name="q" defaultValue={q} placeholder="Ej.: sensor, correa, marcador" className={campo} />
          </label>
          <button type="submit" className={botonPrimario}>
            Buscar
          </button>
        </form>
        <p className="text-sm text-slate-600">
          {casos.length === 0
            ? "No hay soluciones registradas con esa búsqueda."
            : `${casos.length === LIMITE ? `Las ${LIMITE} más recientes` : `${casos.length} ${casos.length === 1 ? "caso" : "casos"}`}, del más nuevo al más antiguo.`}
        </p>
        {casos.map((c) => (
          <article key={c.clave} className={`${tarjeta} flex flex-col gap-1`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">
                {c.activo}
                {c.sistema ? ` · ${c.sistema}` : ""}
              </h2>
              <span className="text-sm text-slate-600">{fechaHora(c.fecha)}</span>
            </div>
            {c.problema && (
              <p className="whitespace-pre-line">
                <span className="font-semibold">Falla:</span> {c.problema}
              </p>
            )}
            {c.causa && (
              <p className="whitespace-pre-line">
                <span className="font-semibold">Causa:</span> {c.causa}
              </p>
            )}
            {c.solucion && (
              <p className="whitespace-pre-line">
                <span className="font-semibold">Solución:</span> {c.solucion}
              </p>
            )}
            {c.acciones && (
              <p className="whitespace-pre-line">
                <span className="font-semibold">Para que no se repita:</span> {c.acciones}
              </p>
            )}
            <p className="text-sm text-slate-600">
              <Link href={c.href} className="text-marca underline">
                {c.titulo}
              </Link>
              {c.quien ? ` · ${c.quien}` : ""}
            </p>
          </article>
        ))}
      </main>
    </>
  );
}
