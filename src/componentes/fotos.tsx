import { MAX_FOTOS } from "@/lib/adjuntos-core";

/** Miniaturas de fotos adjuntas; cada una abre la imagen completa. */
export function Fotos({ ids, titulo = "Fotos" }: { ids: number[]; titulo?: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-slate-600">{titulo}</span>
      <div className="flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <a key={id} href={`/adjuntos/${id}`} target="_blank" rel="noreferrer">
            {/* Imagen servida con control de acceso: no pasa por el optimizador de Next. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/adjuntos/${id}`}
              alt={`${titulo} ${i + 1}`}
              loading="lazy"
              className="size-24 rounded-lg border border-slate-300 object-cover"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

/** Campo para adjuntar fotos desde la cámara o la galería. */
export function CampoFotos({ etiqueta = "Fotos (opcional)" }: { etiqueta?: string }) {
  return (
    <label className="flex flex-col gap-1 text-base font-semibold">
      {etiqueta}
      <input
        type="file"
        name="fotos"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="rounded-lg border border-dashed border-slate-500 bg-slate-50 p-3 text-base font-normal file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-marca file:px-3 file:font-semibold file:text-white"
      />
      <span className="text-sm font-normal text-slate-600">Hasta {MAX_FOTOS} fotos, de 10 MB cada una como máximo.</span>
    </label>
  );
}
