import { botonPrimario, campo } from "@/componentes/ui";
import type { FilaExistencia } from "@/lib/consultas-bodega";

type Maquina = { id: number; nombre: string; codigo: string };

export function FormularioRepuesto({
  accion,
  repuesto,
  maquinas,
  asociadas = [],
  cuentas = [],
}: {
  accion: (f: FormData) => Promise<void>;
  repuesto?: FilaExistencia;
  maquinas: Maquina[];
  asociadas?: number[];
  cuentas?: { id: number; codigo: string; nombre: string; activo: boolean }[];
}) {
  const r = repuesto;
  return (
    <form action={accion} className="grid gap-3 sm:grid-cols-2">
      {r && <input type="hidden" name="id" value={r.id} />}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Código interno
        <input name="codigo" required defaultValue={r?.codigo} autoCapitalize="characters" className={campo} />
      </label>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Código de parte del fabricante
          <input name="codigoFabricante" defaultValue={r?.codigoFabricante ?? ""} className={campo} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="sinCodigoFabricante" value="si" defaultChecked={r?.sinCodigoFabricante ?? false} className="h-5 w-5" />
          Sin código de fabricante (repuesto genérico)
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
        Marca (opcional)
        <input name="marca" defaultValue={r?.marca ?? ""} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
        Descripción
        <input name="descripcion" required defaultValue={r?.descripcion} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Unidad (unidad, litro, kg, metro…)
        <input name="unidad" defaultValue={r?.unidad ?? "unidad"} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Familia
        <input name="familia" defaultValue={r?.familia ?? ""} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Stock mínimo
        <input name="stockMinimo" inputMode="decimal" defaultValue={r?.stockMinimo || ""} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Stock máximo
        <input name="stockMaximo" inputMode="decimal" defaultValue={r?.stockMaximo ?? ""} className={campo} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
        Cuenta contable (opcional)
        <select name="cuentaId" defaultValue={r?.cuentaId ?? ""} className={campo}>
          <option value="">Sin cuenta</option>
          {cuentas
            .filter((c) => c.activo || c.id === r?.cuentaId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} · {c.nombre}
              </option>
            ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
        Máquinas en las que se usa (opcional; mantén Ctrl para elegir varias)
        <select name="activoIds" multiple defaultValue={asociadas.map(String)} className="h-32 rounded-lg border border-slate-400 bg-white p-2 text-base">
          {maquinas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} · {m.codigo}
            </option>
          ))}
        </select>
      </label>
      {r && (
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Estado
          <select name="activo" defaultValue={r.activo ? "si" : "no"} className={campo}>
            <option value="si">Vigente</option>
            <option value="no">Dado de baja</option>
          </select>
        </label>
      )}
      <button type="submit" className={`${botonPrimario} sm:col-span-2`}>
        {r ? "Guardar cambios" : "Crear repuesto"}
      </button>
    </form>
  );
}
