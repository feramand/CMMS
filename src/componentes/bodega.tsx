import Link from "next/link";
import type { FilaExistencia } from "@/lib/consultas-bodega";
import { cant } from "@/lib/formato";

const ENLACES = [
  { href: "/bodega", nombre: "Existencias" },
  { href: "/bodega/solicitudes", nombre: "Solicitudes de repuesto" },
  { href: "/bodega/movimientos", nombre: "Movimientos" },
  { href: "/bodega/inventarios", nombre: "Inventarios" },
  { href: "/bodega/carga", nombre: "Carga desde Excel" },
];

export function MenuBodega({ actual, opera }: { actual: string; opera: boolean }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {ENLACES.filter((e) => opera || e.href !== "/bodega/carga").map((e) => (
        <Link
          key={e.href}
          href={e.href}
          className={`rounded-lg px-3 py-2 text-base font-semibold ${e.href === actual ? "bg-marca text-white" : "border border-slate-300 bg-white text-marca"}`}
        >
          {e.nombre}
        </Link>
      ))}
    </nav>
  );
}

/** Sugerencias del catálogo para un campo de texto: al elegir una, queda "CÓDIGO — descripción". */
export function SugerenciasRepuestos({ id, repuestos }: { id: string; repuestos: FilaExistencia[] }) {
  return (
    <datalist id={id}>
      {repuestos.map((r) => (
        <option key={r.id} value={`${r.codigo} — ${r.descripcion}`}>
          {r.total > 0 ? `Hay ${cant(r.total)} ${r.unidad}` : "Sin existencias"}
          {r.marca ? ` · ${r.marca}` : ""}
          {r.codigoFabricante ? ` · ${r.codigoFabricante}` : ""}
        </option>
      ))}
    </datalist>
  );
}
