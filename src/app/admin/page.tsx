import Link from "next/link";
import { Encabezado } from "@/componentes/encabezado";
import { exigirPerfil } from "@/lib/dal";

const DISPONIBLES = [
  { href: "/admin/tablero", nombre: "Tablero" },
  { href: "/admin/solicitudes", nombre: "Solicitudes" },
  { href: "/admin/ot", nombre: "Órdenes de trabajo" },
  { href: "/admin/preventivo", nombre: "Preventivo" },
  { href: "/admin/indicadores", nombre: "Indicadores" },
  { href: "/admin/activos", nombre: "Activos" },
  { href: "/admin/usuarios", nombre: "Usuarios" },
  { href: "/admin/carga", nombre: "Carga inicial" },
  { href: "/admin/configuracion", nombre: "Configuración" },
];

const MODULOS = ["Compras", "KPI y reportes"];

export default async function PanelAdmin() {
  const usuario = await exigirPerfil("ADMINISTRADOR", "JEFE_PLANIFICADOR", "ABASTECIMIENTO");
  const veUsuarios = usuario.perfil !== "ABASTECIMIENTO";
  return (
    <>
      <Encabezado usuario={usuario} />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <h1 className="mb-4 text-2xl font-bold">Panel general</h1>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {veUsuarios &&
            DISPONIBLES.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="flex h-20 items-center rounded-xl bg-white px-4 text-lg font-semibold text-marca shadow-sm"
              >
                {d.nombre}
              </Link>
            ))}
          <Link href="/bodega" className="flex h-20 items-center rounded-xl bg-white px-4 text-lg font-semibold text-marca shadow-sm">
            Bodega
          </Link>
          {MODULOS.map((m) => (
            <div
              key={m}
              className="flex h-20 items-center justify-between rounded-xl bg-white px-4 text-lg font-medium text-slate-400 shadow-sm"
            >
              {m}
              <span className="text-sm">Próxima etapa</span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
