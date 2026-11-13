import Link from "next/link";
import type { EstadoOc } from "@/db/schema";
import { ESTADOS_OC } from "@/lib/compras-core";
import { Chip } from "./ui";

const ENLACES = [
  { href: "/compras", nombre: "Solicitudes y órdenes" },
  { href: "/compras/sc/nueva", nombre: "Nueva solicitud de compra" },
  { href: "/compras/proveedores", nombre: "Proveedores" },
  { href: "/compras/contabilidad", nombre: "Contabilidad" },
];

export function MenuCompras({ actual }: { actual: string }) {
  return (
    <nav className="flex flex-wrap gap-2 print:hidden">
      {ENLACES.map((e) => (
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

const TONO_OC = { EMITIDA: "ambar", AUTORIZADA: "azul", RECIBIDA_PARCIAL: "azul", RECIBIDA_TOTAL: "verde", RECHAZADA: "rojo", ANULADA: "gris" } as const;
export function ChipOc({ estado }: { estado: EstadoOc }) {
  return <Chip tono={TONO_OC[estado]}>{ESTADOS_OC[estado]}</Chip>;
}

const SC = {
  ENVIADA: ["Por visar", "ambar"],
  APROBADA: ["Visada, con líneas por comprar", "azul"],
  CONVERTIDA: ["Con orden de compra", "verde"],
  RECHAZADA: ["Rechazada", "rojo"],
} as const;
export function ChipSc({ estado }: { estado: keyof typeof SC }) {
  return <Chip tono={SC[estado][1]}>{SC[estado][0]}</Chip>;
}
