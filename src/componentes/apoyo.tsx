import type { Tecnico } from "@/lib/consultas";
import { campo } from "./ui";

/** "Realicé el trabajo con apoyo": hasta 3 técnicos, de cualquier especialidad. */
export function CamposApoyo({ tecnicos, propioId }: { tecnicos: Tecnico[]; propioId: number }) {
  const otros = tecnicos.filter((t) => t.id !== propioId);
  if (otros.length === 0) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-lg font-semibold">Realicé el trabajo con apoyo</summary>
      <div className="mt-3 flex flex-col gap-2">
        {[1, 2, 3].map((n) => (
          <label key={n} className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Técnico de apoyo {n}
            <select name="apoyo" defaultValue="" className={campo}>
              <option value="">— Ninguno —</option>
              {otros.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre} · {t.especialidad}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}
