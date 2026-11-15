/**
 * Lo privado que la app deja en disco y se borra al cambiar de cuenta.
 *
 *   - PDFs de los escaneos: components/common/pdf-viewer los baja a
 *     <cache>/item-pdfs/<id>.pdf para pintarlos (pdf.js no puede pedirlos al
 *     almacenamiento del backend). Son documentos del cliente.
 *   - Fotos de las piezas y escaneos: expo-image las guarda en su cache de disco
 *     y de memoria (las URL firmadas caducan, los bytes no).
 *
 * Se llama con cada cambio de ambito de la sesion (lib/session-scope): cierre
 * de sesion, sesion revocada, otra cuenta u otra organizacion. Nada de aqui
 * puede impedir cerrar la sesion: los fallos se tragan.
 *
 * Sin React ni expo arriba: las dependencias se inyectan, para probarlo.
 */
export const PDF_CACHE_DIRECTORY = "item-pdfs";

export async function clearPrivateFiles({ deletePdfDirectory, clearImageDiskCache, clearImageMemoryCache } = {}) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => deletePdfDirectory?.()),
    Promise.resolve().then(() => clearImageDiskCache?.()),
    Promise.resolve().then(() => clearImageMemoryCache?.()),
  ]);
  return results.map((result) => result.status);
}
