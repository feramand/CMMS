import { and, asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, tarjeta } from "@/componentes/ui";
import { db } from "@/db";
import { activos, competencias, especialidades, fichasTecnico, usuarios } from "@/db/schema";
import { NIVELES } from "@/lib/competencias-core";
import { exigirPerfil } from "@/lib/dal";
import { accionGuardarCompetencias } from "./actions";

const COLOR = { BASICO: "bg-slate-200 text-slate-800", INTERMEDIO: "bg-blue-100 text-blue-900", AVANZADO: "bg-green-200 text-green-900" } as const;

// Matriz de competencias: nivel de cada técnico en cada máquina. Ayuda a decidir a quién asignar un trabajo.
export default async function Competencias({ searchParams }: { searchParams: Promise<{ tecnico?: string; error?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const pedido = await searchParams;
  const [tecnicos, maquinas, filas] = await Promise.all([
    db
      .select({ id: usuarios.id, nombre: usuarios.nombre, especialidad: especialidades.nombre })
      .from(usuarios)
      .leftJoin(fichasTecnico, eq(fichasTecnico.usuarioId, usuarios.id))
      .leftJoin(especialidades, eq(especialidades.id, fichasTecnico.especialidadId))
      .where(and(eq(usuarios.perfil, "TECNICO"), eq(usuarios.activo, true)))
      .orderBy(asc(usuarios.nombre)),
    db.select({ id: activos.id, nombre: activos.nombre, codigo: activos.codigo }).from(activos).where(ne(activos.estadoOperativo, "DESINSTALADO")).orderBy(asc(activos.nombre)),
    db.select().from(competencias),
  ]);
  const nivelDe = (usuarioId: number, activoId: number) => filas.find((f) => f.usuarioId === usuarioId && f.activoId === activoId)?.nivel;
  const elegido = tecnicos.find((t) => t.id === Number(pedido.tecnico));
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Matriz de competencias</h1>
        <AvisoError mensaje={pedido.error} />
        <p className="text-slate-700">
          Nivel de cada técnico en cada máquina: {NIVELES.map((n) => `${n.sigla} = ${n.nombre.toLowerCase()}`).join(", ")}. Una
          celda vacía significa que no tiene competencia registrada. Toca el nombre de un técnico para editar sus niveles.
        </p>

        {elegido && (
          <section className={`${tarjeta} flex flex-col gap-3`}>
            <h2 className="text-lg font-bold">
              Competencias de {elegido.nombre}
              {elegido.especialidad ? ` · ${elegido.especialidad}` : ""}
            </h2>
            <form action={accionGuardarCompetencias} className="flex flex-col gap-3">
              <input type="hidden" name="usuarioId" value={elegido.id} />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {maquinas.map((m) => (
                  <label key={m.id} className="flex flex-col gap-1 text-sm font-semibold">
                    {m.nombre}
                    <select name={`nivel-${m.id}`} defaultValue={nivelDe(elegido.id, m.id) ?? ""} className={campo}>
                      <option value="">Sin competencia</option>
                      {NIVELES.map((n) => (
                        <option key={n.valor} value={n.valor}>
                          {n.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button type="submit" className={`${botonPrimario} self-start`}>
                Guardar competencias
              </button>
            </form>
          </section>
        )}

        <section className={`${tarjeta} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">
            {tecnicos.length} técnicos · {maquinas.length} máquinas
          </h2>
          {tecnicos.length === 0 || maquinas.length === 0 ? (
            <p className="text-slate-600">Faltan técnicos o máquinas para armar la matriz.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-left text-base">
                <thead className="text-sm text-slate-600">
                  <tr>
                    <th className="sticky left-0 bg-white p-2 font-semibold">Máquina</th>
                    {tecnicos.map((t) => (
                      <th key={t.id} className="p-2 font-semibold">
                        <Link href={`/admin/competencias?tecnico=${t.id}`} className="text-marca underline">
                          {t.nombre}
                        </Link>
                        <span className="block text-xs font-normal">{t.especialidad ?? ""}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maquinas.map((m) => (
                    <tr key={m.id} className="border-t border-slate-200">
                      <th scope="row" className="sticky left-0 bg-white p-2 font-normal">
                        {m.nombre}
                      </th>
                      {tecnicos.map((t) => {
                        const nivel = nivelDe(t.id, m.id);
                        const dato = NIVELES.find((n) => n.valor === nivel);
                        return (
                          <td key={t.id} className="p-2 text-center">
                            {dato ? (
                              <span title={dato.nombre} className={`inline-block w-8 rounded py-0.5 font-semibold ${COLOR[dato.valor]}`}>
                                {dato.sigla}
                              </span>
                            ) : (
                              <span className="text-slate-400">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
