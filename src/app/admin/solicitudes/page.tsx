import { and, eq, inArray, type SQL } from "drizzle-orm";
import Link from "next/link";
import { accionAsignarSolicitud } from "@/app/trabajos/actions";
import { Encabezado } from "@/componentes/encabezado";
import { AvisoError, botonPrimario, campo, ChipSat, tarjeta } from "@/componentes/ui";
import { solicitudes, type Categoria } from "@/db/schema";
import { CATEGORIAS, especialidadesDe, nombreCategoria } from "@/lib/categorias";
import { listarSolicitudes, listarTecnicos } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { fechaHora, minutosEntre } from "@/lib/tiempo";

type Props = { searchParams: Promise<{ estado?: string; categoria?: string; sel?: string; error?: string }> };

const ORIGEN = { METRICS: "Metrics", OPERADOR: "Operador", TECNICO: "Técnico", JEFE: "Jefatura", PAUTA: "Pauta" };

export default async function Solicitudes({ searchParams }: Props) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { estado = "abiertas", categoria = "", sel, error } = await searchParams;
  const filtros: SQL[] = [];
  if (estado === "abiertas") filtros.push(inArray(solicitudes.estado, ["PENDIENTE", "EN_ATENCION", "ESCALADA"]));
  if (estado === "cerradas") filtros.push(inArray(solicitudes.estado, ["SOLUCIONADA", "CERRADA", "ANULADA"]));
  if (CATEGORIAS.some((c) => c.valor === categoria)) filtros.push(eq(solicitudes.categoria, categoria as Categoria));
  const [lista, tecnicos] = await Promise.all([listarSolicitudes(and(...filtros)), listarTecnicos()]);
  const elegida = lista.find((s) => String(s.id) === sel && (s.estado === "PENDIENTE" || s.estado === "EN_ATENCION"));
  const candidatos = elegida ? tecnicos.filter((t) => especialidadesDe(elegida.categoria).includes(t.codigo)) : [];
  const enlace = (id: number) => `/admin/solicitudes?estado=${estado}&categoria=${categoria}&sel=${id}`;

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-wrap items-start gap-4 p-4">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Solicitudes de atención · {lista.length}</h1>
            <Link href="/reportar" className={`${botonPrimario} bg-amber-700`}>
              Nueva solicitud
            </Link>
          </div>
          <AvisoError mensaje={error} />
          <form className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              Estado
              <select name="estado" defaultValue={estado} className={`${campo} w-44`}>
                <option value="abiertas">Abiertas</option>
                <option value="todas">Todas</option>
                <option value="cerradas">Cerradas</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              Tipo de falla
              <select name="categoria" defaultValue={categoria} className={`${campo} w-52`}>
                <option value="">Todas</option>
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={botonPrimario}>
              Filtrar
            </button>
          </form>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] text-left text-base">
              <thead className="text-sm text-slate-600">
                <tr>
                  <th className="p-3 font-semibold">Máquina</th>
                  <th className="p-3 font-semibold">Planta</th>
                  <th className="p-3 font-semibold">Tipo de falla</th>
                  <th className="p-3 font-semibold">Origen</th>
                  <th className="p-3 font-semibold">Creada</th>
                  <th className="p-3 font-semibold">Estado</th>
                  <th className="p-3 font-semibold">A cargo</th>
                  <th className="p-3 font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3 text-slate-600">
                      No hay solicitudes con este filtro.
                    </td>
                  </tr>
                )}
                {lista.map((s) => {
                  const espera = s.estado === "PENDIENTE" ? minutosEntre(s.creadaEn, new Date()) : null;
                  return (
                    <tr key={s.id} className={`border-t border-slate-200 ${elegida?.id === s.id ? "bg-blue-50" : ""}`}>
                      <td className="p-3 font-semibold">
                        <Link href={`/sat/${s.id}`} className="text-marca underline">
                          {s.activo}
                        </Link>
                      </td>
                      <td className="p-3">{s.planta}</td>
                      <td className="p-3">{nombreCategoria(s.categoria)}</td>
                      <td className="p-3">{ORIGEN[s.origen]}</td>
                      <td className="p-3">
                        {fechaHora(s.creadaEn)}
                        {espera !== null ? ` · espera ${espera} min` : ""}
                      </td>
                      <td className="p-3">
                        {s.estado === "ESCALADA" && s.otId ? (
                          <Link href={`/ot/${s.otId}`} className="underline">
                            Escalada a OT {s.folioOt}
                          </Link>
                        ) : (
                          <ChipSat estado={s.estado} />
                        )}
                      </td>
                      <td className="p-3">{s.responsable ?? "Sin asignar"}</td>
                      <td className="p-3">
                        {(s.estado === "PENDIENTE" || s.estado === "EN_ATENCION") && (
                          <Link href={enlace(s.id)} className="font-semibold text-marca underline">
                            {s.responsable ? "Reasignar" : "Asignar"}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {elegida && (
          <aside className={`${tarjeta} flex min-w-0 flex-[1_1_320px] flex-col gap-3`}>
            <h2 className="text-lg font-bold">Asignar solicitud</h2>
            <p className="text-slate-600">
              {elegida.activo} · {nombreCategoria(elegida.categoria)}
            </p>
            {candidatos.length === 0 ? (
              <p className="text-amber-800">No hay técnicos de esta especialidad.</p>
            ) : (
              <form action={accionAsignarSolicitud} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={elegida.id} />
                {candidatos.map((t) => (
                  <label
                    key={t.id}
                    className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 has-checked:border-2 has-checked:border-marca has-checked:bg-blue-50"
                  >
                    <input type="radio" name="tecnicoId" value={t.id} required className="size-5" />
                    <span className="flex flex-col">
                      <span className="font-semibold">
                        {t.nombre} · {t.especialidad}
                      </span>
                      <span className={`text-sm font-semibold ${t.disponible ? "text-green-800" : "text-slate-600"}`}>
                        {t.modalidad === "HORARIO_FIJO" ? "Horario fijo" : t.enTurno ? "De turno" : "Fuera de turno"} ·{" "}
                        {t.trabajosAbiertos === 0 ? "sin trabajos abiertos" : `${t.trabajosAbiertos} trabajos abiertos`}
                      </span>
                    </span>
                  </label>
                ))}
                <button type="submit" className={botonPrimario}>
                  Asignar
                </button>
              </form>
            )}
          </aside>
        )}
      </main>
    </>
  );
}
