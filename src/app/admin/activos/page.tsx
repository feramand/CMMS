import { asc } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, Chip, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { plantas, tiposMaquina } from "@/db/schema";
import { listarActivos } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { accionCrearActivo } from "./actions";

const ESTADO = {
  ACTIVO: { nombre: "Activo", tono: "verde" },
  FUERA_DE_SERVICIO: { nombre: "Fuera de servicio", tono: "ambar" },
  DESINSTALADO: { nombre: "Desinstalado", tono: "gris" },
} as const;

const CAMPOS: [string, string, boolean?][] = [
  ["codigo", "ID del activo", true],
  ["nombre", "Nombre de la máquina", true],
  ["fabricante", "Fabricante"],
  ["modelo", "Modelo"],
  ["numeroSerie", "Número de serie"],
  ["formato", "Formato de trabajo"],
  ["paisOrigen", "País de origen"],
  ["anioFabricacion", "Año de fabricación"],
  ["anioLlegada", "Año de llegada"],
  ["anioInstalacion", "Año de instalación"],
  ["seccion", "Ubicación o sección"],
  ["garantia", "Garantía"],
  ["codigoMetrics", "Código en Metrics"],
];

export default async function Activos({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const [lista, listaPlantas, listaTipos] = await Promise.all([
    listarActivos(),
    db.select().from(plantas).orderBy(asc(plantas.nombre)),
    db.select().from(tiposMaquina).orderBy(asc(tiposMaquina.nombre)),
  ]);
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Activos · {lista.length}</h1>
          <Link href="/admin/tipos" className="text-marca underline">
            Tipos de máquina y plantillas de sistemas
          </Link>
        </div>
        <AvisoError mensaje={error} />
        <details className={tarjeta} open={Boolean(error)}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Nuevo activo</summary>
          <form action={accionCrearActivo} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS.map(([nombre, etiqueta, obligatorio]) => (
              <label key={nombre} className="flex flex-col gap-1 text-sm font-semibold">
                {etiqueta}
                <input name={nombre} required={obligatorio} className={campo} />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Planta
              <select name="plantaId" required className={campo}>
                {listaPlantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Tipo de máquina
              <select name="tipoMaquinaId" defaultValue="" className={campo}>
                <option value="">Sin indicar</option>
                {listaTipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Condición de llegada
              <select name="condicionLlegada" defaultValue="" className={campo}>
                <option value="">Sin indicar</option>
                <option value="NUEVA">Nueva</option>
                <option value="USADA">Usada</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2 lg:col-span-3">
              Sistemas propios de esta máquina, además de la plantilla de su tipo (uno por línea). Opcional.
              <textarea name="sectores" rows={3} placeholder={"Marcador\nCuerpo impresor 1\nSalida"} className="rounded-lg border border-slate-400 bg-white p-2 text-base font-normal" />
            </label>
            <button type="submit" className={`${botonPrimario} sm:col-span-2 lg:col-span-3`}>
              Crear activo
            </button>
          </form>
        </details>
        {lista.length === 0 && <p className="text-slate-600">Todavía no hay activos. Crea el primero arriba.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {lista.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/activos/${a.id}`} className={`${tarjeta} flex items-center justify-between gap-2`}>
                <span className="flex flex-col">
                  <span className="text-lg font-semibold">{a.nombre}</span>
                  <span className="text-sm text-slate-600">
                    {a.codigo} · {a.planta}
                    {a.tipo ? ` · ${a.tipo}` : ""}
                    {a.seccion ? ` · ${a.seccion}` : ""}
                  </span>
                </span>
                <Chip tono={ESTADO[a.estadoOperativo].tono}>{ESTADO[a.estadoOperativo].nombre}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
