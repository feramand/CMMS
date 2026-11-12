import type { EstadoOt, EstadoSat } from "@/db/schema";
import { nombreEstadoOt } from "@/lib/ot-core";

const TONOS = {
  ambar: "bg-amber-100 text-amber-800",
  azul: "bg-blue-100 text-blue-800",
  verde: "bg-green-100 text-green-800",
  gris: "bg-slate-200 text-slate-700",
  rojo: "bg-red-100 text-red-800",
} as const;

export function Chip({ tono, children }: { tono: keyof typeof TONOS; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-sm font-semibold ${TONOS[tono]}`}>
      {children}
    </span>
  );
}

const SAT: Record<EstadoSat, { nombre: string; tono: keyof typeof TONOS }> = {
  PENDIENTE: { nombre: "Pendiente", tono: "ambar" },
  EN_ATENCION: { nombre: "En atención", tono: "azul" },
  SOLUCIONADA: { nombre: "Solucionada", tono: "verde" },
  ESCALADA: { nombre: "Escalada a OT", tono: "gris" },
  CERRADA: { nombre: "Solucionada con OT", tono: "verde" },
  ANULADA: { nombre: "Anulada", tono: "gris" },
};

export function ChipSat({ estado }: { estado: EstadoSat }) {
  return <Chip tono={SAT[estado].tono}>{SAT[estado].nombre}</Chip>;
}

const OT_TONO: Record<EstadoOt, keyof typeof TONOS> = {
  CREADA: "ambar",
  ASIGNADA: "azul",
  EN_CURSO: "azul",
  ESPERA_REPUESTOS: "ambar",
  FINALIZADA: "verde",
  CANCELADA: "gris",
};

export function ChipOt({ estado }: { estado: EstadoOt }) {
  return <Chip tono={OT_TONO[estado]}>{nombreEstadoOt(estado)}</Chip>;
}

export function AvisoError({ mensaje }: { mensaje?: string | string[] }) {
  if (!mensaje || Array.isArray(mensaje)) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-base text-red-800">
      {mensaje}
    </p>
  );
}

export function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-slate-600">{etiqueta}</span>
      <span className="text-base font-semibold">{children}</span>
    </div>
  );
}

export const campo = "h-12 w-full rounded-lg border border-slate-400 bg-white px-3 text-base";
export const boton = "flex h-12 items-center justify-center rounded-lg px-4 text-base font-semibold";
export const botonPrimario = `${boton} bg-marca text-white`;
export const botonSecundario = `${boton} border-2 border-marca bg-white text-marca`;
export const tarjeta = "rounded-xl border border-slate-200 bg-white p-4";
