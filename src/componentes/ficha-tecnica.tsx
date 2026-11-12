import type { activos } from "@/db/schema";
import { Dato } from "./ui";

type Activo = typeof activos.$inferSelect;

const ESTADO = { ACTIVO: "Activo", FUERA_DE_SERVICIO: "Fuera de servicio", DESINSTALADO: "Desinstalado" } as const;

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

/** Datos de la ficha técnica de una máquina, tal como se ven en la ficha y al escanear su QR. */
export function FichaTecnica({ m, tipo }: { m: Activo; tipo: string | null }) {
  const v = (x: string | number | null) => x ?? "—";
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <Dato etiqueta="ID del activo">{m.codigo}</Dato>
      <Dato etiqueta="Tipo de máquina">{v(tipo)}</Dato>
      <Dato etiqueta="Estado del equipo">{ESTADO[m.estadoOperativo]}</Dato>
      <Dato etiqueta="Fabricante">{v(m.fabricante)}</Dato>
      <Dato etiqueta="Modelo">{v(m.modelo)}</Dato>
      <Dato etiqueta="Número de serie">{v(m.numeroSerie)}</Dato>
      <Dato etiqueta="Formato de trabajo">{v(m.formato)}</Dato>
      <Dato etiqueta="País de origen">{v(m.paisOrigen)}</Dato>
      <Dato etiqueta="Año de fabricación">{v(m.anioFabricacion)}</Dato>
      <Dato etiqueta="Año de llegada">{v(m.anioLlegada)}</Dato>
      <Dato etiqueta="Año de instalación">{v(m.anioInstalacion)}</Dato>
      <Dato etiqueta="Condición de llegada">
        {m.condicionLlegada === "NUEVA" ? "Nueva" : m.condicionLlegada === "USADA" ? "Usada" : "—"}
      </Dato>
      <Dato etiqueta="Garantía">{v(m.garantia)}</Dato>
      <Dato etiqueta="Código en Metrics">{v(m.codigoMetrics)}</Dato>
      <Dato etiqueta="Giros acumulados">
        {m.girosAcumulados === null ? "—" : m.girosAcumulados.toLocaleString("es-CL")}
      </Dato>
      <Dato etiqueta="Última preventiva">{fecha(m.ultimaPreventiva)}</Dato>
      <Dato etiqueta="Último MP">{v(m.ultimoMp)}</Dato>
    </div>
  );
}
