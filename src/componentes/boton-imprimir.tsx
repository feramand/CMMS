"use client";

export function BotonImprimir({ className, texto = "Imprimir etiqueta" }: { className?: string; texto?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {texto}
    </button>
  );
}
