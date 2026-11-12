import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { accionCrearPauta, accionGuardarPorcentajes, accionLiberar } from "@/app/preventivo/actions";
import { Encabezado } from "@/componentes/encabezado";
import { BarraAvance, ChipPauta } from "@/componentes/pautas";
import { AvisoError, botonPrimario, botonSecundario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { especialidades } from "@/db/schema";
import { listarActivosVigentes } from "@/lib/consultas";
import { intervaloTexto, listarPautas } from "@/lib/consultas-pautas";
import { exigirPerfil } from "@/lib/dal";
import { porcentajesGenerales } from "@/lib/pautas-core";

export default async function Preventivo({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { error } = await searchParams;
  const [lista, maquinas, listaEsp, pct] = await Promise.all([
    listarPautas(),
    listarActivosVigentes(),
    db.select().from(especialidades).where(eq(especialidades.activa, true)).orderBy(asc(especialidades.nombre)),
    porcentajesGenerales(db),
  ]);
  const liberadas = lista.filter((p) => p.activa && p.ciclo?.estado === "LIBERADA");
  const programadas = lista.filter((p) => p.activa && p.ciclo?.estado === "PROGRAMADA");
  const resto = lista.filter((p) => !p.activa || !p.ciclo);
  const grupos = [
    { titulo: "Liberadas, pendientes de ejecutar", pautas: liberadas, vacio: "No hay pautas liberadas." },
    { titulo: "Programadas", pautas: programadas, vacio: "No hay pautas programadas." },
    { titulo: "Inactivas", pautas: resto, vacio: "" },
  ];
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Planificación preventiva · {lista.length} pautas</h1>
        <AvisoError mensaje={error} />

        <details className={tarjeta} open={Boolean(error)}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">Nueva pauta</summary>
          {maquinas.length === 0 ? (
            <p className="mt-3 text-slate-600">Primero registra una máquina en Activos.</p>
          ) : (
            <form action={accionCrearPauta} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Máquina
                <select name="activoId" required className={campo}>
                  {maquinas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} · {m.planta}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Nombre de la pauta
                <input name="nombre" required placeholder="Por ejemplo: Lubricación general" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Se mide por
                <select name="tipo" required className={campo}>
                  <option value="TIEMPO">Tiempo (días)</option>
                  <option value="GIROS">Giros de la máquina</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Intervalo (días o giros, según lo anterior)
                <input name="intervalo" required inputMode="numeric" placeholder="30 o 500.000" className={campo} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Especialidad que la ejecuta
                <select name="especialidadId" required className={campo}>
                  {listaEsp.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Fecha de la última mantención
                  <input name="baseFecha" type="date" className={campo} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Giros de la última mantención
                  <input name="baseGiros" inputMode="numeric" className={campo} />
                </label>
              </div>
              <p className="text-sm text-slate-600 sm:col-span-2">
                El punto de partida es opcional. Si lo dejas vacío, la pauta por tiempo parte hoy y la pauta por giros
                parte en el contador actual de la máquina.
              </p>
              <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
                Actividades del checklist (una por línea)
                <textarea name="actividades" rows={4} className="rounded-lg border border-slate-400 bg-white p-2 text-base font-normal" />
              </label>
              <button type="submit" className={`${botonPrimario} sm:col-span-2`}>
                Crear pauta
              </button>
            </form>
          )}
        </details>

        {grupos.map(
          (g) =>
            (g.pautas.length > 0 || g.vacio) && (
              <section key={g.titulo} className="flex flex-col gap-2">
                <h2 className="text-lg font-bold">
                  {g.titulo} · {g.pautas.length}
                </h2>
                {g.pautas.length === 0 && <p className="text-slate-600">{g.vacio}</p>}
                <ul className="grid gap-3 sm:grid-cols-2">
                  {g.pautas.map((p) => (
                    <li key={p.id} className={`${tarjeta} flex flex-col gap-2`}>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/admin/preventivo/${p.id}`} className="flex flex-col">
                          <span className="text-lg font-semibold text-marca underline">{p.nombre}</span>
                          <span className="text-sm text-slate-600">
                            {p.activo} · {p.especialidad} · {intervaloTexto(p.tipo, p.intervalo)}
                          </span>
                        </Link>
                        <ChipPauta p={p} />
                      </div>
                      {p.ciclo && p.resumen && p.activa && (
                        <>
                          <BarraAvance avance={p.resumen.avance} liberada={p.ciclo.estado === "LIBERADA"} />
                          <span className="text-sm text-slate-700">
                            {p.ciclo.estado === "PROGRAMADA"
                              ? `Se libera: ${p.resumen.liberacion} · objetivo: ${p.resumen.objetivo}`
                              : `Objetivo: ${p.resumen.objetivo} · límite: ${p.resumen.limite}${p.ciclo.responsable ? ` · la ejecuta ${p.ciclo.responsable}` : ""}`}
                          </span>
                          {p.ciclo.estado === "PROGRAMADA" ? (
                            <form action={accionLiberar}>
                              <input type="hidden" name="cicloId" value={p.ciclo.id} />
                              <button type="submit" className={`${botonSecundario} h-11 text-sm`}>
                                Liberar ahora
                              </button>
                            </form>
                          ) : (
                            <Link href={`/pauta/${p.ciclo.id}`} className="text-marca underline">
                              Abrir checklist
                            </Link>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )}

        <details className={tarjeta}>
          <summary className="cursor-pointer text-lg font-semibold text-marca">
            Porcentajes generales: liberación al {pct.liberacion} %, incumplida al {pct.limite} %
          </summary>
          <form action={accionGuardarPorcentajes} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Liberación (%)
              <input name="liberacion" inputMode="numeric" defaultValue={pct.liberacion} required className={`${campo} w-32`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Incumplida (%)
              <input name="limite" inputMode="numeric" defaultValue={pct.limite} required className={`${campo} w-32`} />
            </label>
            <button type="submit" className={botonPrimario}>
              Guardar
            </button>
          </form>
          <p className="mt-2 text-sm text-slate-600">
            Valen para todas las pautas que no tengan porcentajes propios, desde el próximo ciclo que se programe.
          </p>
        </details>
      </main>
    </>
  );
}
