"use client";

export function BotonImprimir({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Imprimir etiqueta
    </button>
  );
}
