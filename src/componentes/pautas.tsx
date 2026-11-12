import type { PautaListada } from "@/lib/consultas-pautas";
import { Chip } from "./ui";

/** Estado del ciclo abierto de una pauta, como etiqueta de color. */
export function ChipPauta({ p }: { p: Pick<PautaListada, "activa" | "ciclo" | "resumen" | "incluidaEn"> }) {
  if (!p.activa) return <Chip tono="gris">Inactiva</Chip>;
  if (p.incluidaEn) return <Chip tono="azul">Incluida en {p.incluidaEn.nombre}</Chip>;
  if (!p.ciclo) return <Chip tono="gris">Sin ciclo</Chip>;
  if (p.ciclo.estado === "PROGRAMADA") return <Chip tono="gris">Programada</Chip>;
  if (p.resumen?.pasoObjetivo) return <Chip tono="rojo">Próxima a vencer</Chip>;
  return <Chip tono="ambar">Liberada</Chip>;
}

/** Barra de avance del intervalo. Se llena al 100 % (objetivo) y cambia de color según el tramo. */
export function BarraAvance({ avance, liberada }: { avance: number; liberada: boolean }) {
  const color = avance >= 100 ? "bg-red-600" : liberada ? "bg-amber-500" : "bg-marca";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Avance ${avance} %`}>
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, avance)}%` }} />
      </div>
      <span className="w-14 text-right text-sm font-semibold tabular-nums">{avance} %</span>
    </div>
  );
}
