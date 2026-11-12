import { count, inArray } from "drizzle-orm";
import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { Chip } from "@/componentes/ui";
import { db } from "@/db";
import { solicitudesRepuesto } from "@/db/schema";
import { nombreCategoria } from "@/lib/categorias";
import { listarOts, listarSolicitudes } from "@/lib/consultas";
import { exigirPerfil } from "@/lib/dal";
import { nombreEstadoOt } from "@/lib/ot-core";
import { duracion, fechaHora, minutosEntre } from "@/lib/tiempo";

type Tarjeta = { href: string; folio: string; titulo: string; detalle: string; pie: string; repuestos?: boolean };
type Columna = { nombre: string; tarjetas: Tarjeta[]; nota?: string };

const PESTANAS = [
  { valor: "sat", nombre: "Solicitudes (SAT)" },
  { valor: "ot", nombre: "Órdenes de trabajo" },
  { valor: "rep", nombre: "Repuestos y compras" },
  { valor: "mp", nombre: "Preventivo (MP)" },
];

const DIAS_TERMINADAS = 7;

function reciente(fecha: Date | null): boolean {
  return fecha !== null && Date.now() - fecha.getTime() <= DIAS_TERMINADAS * 24 * 60 * 60 * 1000;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "sin fecha";
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

/** Ids de solicitudes y de OT con algún repuesto pedido y todavía no entregado. */
async function conRepuestosPendientes() {
  const filas = await db
    .select({ solicitudId: solicitudesRepuesto.solicitudId, otId: solicitudesRepuesto.otId, n: count() })
    .from(solicitudesRepuesto)
    .where(inArray(solicitudesRepuesto.estado, ["PENDIENTE", "APROBADA"]))
    .groupBy(solicitudesRepuesto.solicitudId, solicitudesRepuesto.otId);
  return {
    sat: new Set(filas.map((f) => f.solicitudId).filter((x): x is number => x !== null)),
    ot: new Set(filas.map((f) => f.otId).filter((x): x is number => x !== null)),
  };
}

async function columnasSat(): Promise<Columna[]> {
  const [lista, pendientes] = await Promise.all([listarSolicitudes(undefined, 300), conRepuestosPendientes()]);
  const tarjeta = (s: (typeof lista)[number], pie: string): Tarjeta => ({
    href: `/sat/${s.id}`,
    folio: `${nombreCategoria(s.categoria)} · ${s.planta}`,
    titulo: s.activo,
    detalle: s.solucion ? `${s.sector}: ${s.solucion}` : (s.comentario ?? `Falla ${nombreCategoria(s.categoria).toLowerCase()}`),
    pie,
    repuestos: pendientes.sat.has(s.id),
  });
  return [
    {
      nombre: "Pendientes",
      tarjetas: lista
        .filter((s) => s.estado === "PENDIENTE")
        .map((s) => tarjeta(s, `Sin tomar · espera ${duracion(minutosEntre(s.creadaEn, new Date()))}`)),
    },
    {
      nombre: "Planificadas",
      tarjetas: [],
      nota: "Las solicitudes no se planifican: se atienden al momento. Si requieren programación, pasan a orden de trabajo.",
    },
    {
      nombre: "En proceso",
      tarjetas: lista
        .filter((s) => s.estado === "EN_ATENCION" || s.estado === "ESCALADA")
        .map((s) => tarjeta(s, s.estado === "ESCALADA" ? `Escalada a OT ${s.folioOt} · ${s.responsable}` : `${s.responsable} · desde ${fechaHora(s.tomadaEn)}`)),
    },
    {
      nombre: "Terminadas",
      tarjetas: lista
        .filter((s) => (s.estado === "SOLUCIONADA" || s.estado === "CERRADA") && reciente(s.cerradaEn))
        .map((s) => tarjeta(s, `${s.responsable} · ${duracion(minutosEntre(s.tomadaEn, s.cerradaEn))}`)),
    },
  ];
}

async function columnasOt(): Promise<Columna[]> {
  const [lista, pendientes] = await Promise.all([listarOts(undefined, 300), conRepuestosPendientes()]);
  const tarjeta = (o: (typeof lista)[number], pie: string): Tarjeta => ({
    href: `/ot/${o.id}`,
    folio: `OT ${o.folio} · ${o.tipo.charAt(0)}${o.tipo.slice(1).toLowerCase()}`,
    titulo: o.activo,
    detalle: o.descripcion,
    pie,
    repuestos: o.estado === "ESPERA_REPUESTOS" || pendientes.ot.has(o.id),
  });
  const quien = (o: (typeof lista)[number]) => o.responsable ?? o.proveedorExterno ?? "Sin responsable";
  const sinEmpezar = lista.filter((o) => o.estado === "CREADA" || o.estado === "ASIGNADA");
  return [
    {
      nombre: "Pendientes",
      tarjetas: sinEmpezar
        .filter((o) => !o.fechaProgramada)
        .map((o) => tarjeta(o, `${quien(o)} · prioridad ${o.prioridad.toLowerCase()}`)),
    },
    {
      nombre: "Planificadas",
      tarjetas: sinEmpezar
        .filter((o) => o.fechaProgramada)
        .map((o) => tarjeta(o, `${quien(o)} · ${fechaCorta(o.fechaProgramada)}`)),
    },
    {
      nombre: "En proceso",
      tarjetas: lista
        .filter((o) => o.estado === "EN_CURSO" || o.estado === "ESPERA_REPUESTOS")
        .map((o) => tarjeta(o, `${quien(o)} · ${nombreEstadoOt(o.estado).toLowerCase()}`)),
    },
    {
      nombre: "Terminadas",
      tarjetas: lista
        .filter((o) => o.estado === "FINALIZADA" && reciente(o.terminoEn))
        .map((o) => tarjeta(o, `${quien(o)} · ${duracion(minutosEntre(o.inicioEn, o.terminoEn))}`)),
    },
  ];
}

const PROXIMAMENTE: Record<string, string> = {
  rep: "Repuestos y compras se activa con las etapas 3 y 4 (bodega y compras).",
  mp: "Preventivo se activa con la etapa 2 (pautas por tiempo y por giros).",
};

export default async function Tablero({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR");
  const { tipo: pedido } = await searchParams;
  const tipo = PESTANAS.some((p) => p.valor === pedido) ? pedido! : "sat";
  const columnas =
    tipo === "sat"
      ? await columnasSat()
      : tipo === "ot"
        ? await columnasOt()
        : ["Pendientes", "Planificadas", "En proceso", "Terminadas"].map((nombre) => ({ nombre, tarjetas: [] }) as Columna);

  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Tablero</h1>
          <nav aria-label="Tipo de trabajo" className="flex flex-wrap gap-1 rounded-xl bg-slate-200 p-1">
            {PESTANAS.map((p) => (
              <Link
                key={p.valor}
                href={`/admin/tablero?tipo=${p.valor}`}
                aria-current={p.valor === tipo ? "page" : undefined}
                className={`flex h-11 items-center rounded-lg px-4 text-base ${
                  p.valor === tipo ? "bg-marca font-semibold text-white" : "font-medium text-slate-900"
                }`}
              >
                {p.nombre}
              </Link>
            ))}
          </nav>
        </div>
        {PROXIMAMENTE[tipo] && (
          <p role="status" className="rounded-lg bg-blue-100 px-4 py-3 text-blue-900">
            {PROXIMAMENTE[tipo]}
          </p>
        )}
        <div className="overflow-x-auto">
          <div className="grid min-w-[1000px] grid-cols-4 items-start gap-4">
            {columnas.map((c) => (
              <section key={c.nombre} className="flex min-h-96 flex-col gap-2 rounded-2xl bg-slate-200 p-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-base font-bold">{c.nombre}</h2>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-semibold text-slate-700">
                    {c.tarjetas.length}
                  </span>
                </div>
                {c.tarjetas.map((k) => (
                  <Link key={k.href} href={k.href} className="flex flex-col gap-1.5 rounded-lg border border-slate-300 bg-white p-3">
                    <span className="text-sm font-semibold text-slate-600">{k.folio}</span>
                    <span className="text-base font-semibold">{k.titulo}</span>
                    <span className="text-sm text-slate-600">{k.detalle}</span>
                    {k.repuestos && (
                      <span>
                        <Chip tono="ambar">Pendiente de repuestos</Chip>
                      </span>
                    )}
                    <span className="text-sm text-slate-600">{k.pie}</span>
                  </Link>
                ))}
                {c.nota && <p className="p-1 text-sm text-slate-600">{c.nota}</p>}
              </section>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Terminadas muestra los últimos {DIAS_TERMINADAS} días. Cada tarjeta abre su ficha.
        </p>
      </main>
    </>
  );
}
