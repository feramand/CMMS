"use client";

import { useActionState } from "react";
import type { EstadoCarga } from "./actions";

export function FormularioCarga({
  accion,
  etiqueta,
  children,
}: {
  accion: (estado: EstadoCarga, formData: FormData) => Promise<EstadoCarga>;
  etiqueta: string;
  /** Campos adicionales del formulario, antes del archivo. */
  children?: React.ReactNode;
}) {
  const [estado, enviar, cargando] = useActionState(accion, undefined);
  return (
    <form action={enviar} className="flex flex-col gap-3">
      {children}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {etiqueta}
        <input
          type="file"
          name="planilla"
          required
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="rounded-lg border border-dashed border-slate-500 bg-slate-50 p-3 text-base font-normal file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-marca file:px-3 file:font-semibold file:text-white"
        />
      </label>
      <button
        type="submit"
        disabled={cargando}
        className="h-12 rounded-lg bg-marca text-base font-semibold text-white disabled:opacity-60"
      >
        {cargando ? "Cargando…" : "Cargar planilla"}
      </button>
      {estado?.ok && (
        <p role="status" className="rounded-lg bg-green-100 px-4 py-3 text-green-900">
          {estado.ok}
        </p>
      )}
      {estado?.error && (
        <div role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-red-900">
          <p className="font-semibold">{estado.error}</p>
          {estado.errores && (
            <ul className="mt-2 list-disc pl-5">
              {estado.errores.slice(0, 50).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {estado.errores.length > 50 && <li>… y {estado.errores.length - 50} más.</li>}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
