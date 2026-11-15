import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Download, FileText, X } from "lucide-react-native";

import { brand } from "@/lib/brand";
import { buildPdfHtml, isAllowedPdfViewerNavigation, PDF_VIEWER_ORIGIN } from "@/lib/pdf-html";
import { PDFJS_LIBRARY_BASE64, PDFJS_WORKER_BASE64 } from "@/vendor/pdfjs/pdfjs-4.10.38";
import { PDF_CACHE_DIRECTORY } from "@/lib/private-files";

/**
 * PDFs del item (los escaneos) vistos dentro de la app.
 *
 * Ni Android ni expo-image saben pintar un PDF, asi que se dibuja con pdf.js
 * dentro de un WebView. El archivo se baja primero con expo-file-system (URL
 * firmada) y se le pasa al WebView ya leido: pedirlo desde el WebView dependeria
 * de que el almacenamiento del backend acepte peticiones de otro origen.
 *
 * pdf.js va empaquetado con la app (src/vendor/pdfjs, scripts/vendor-pdfjs.js),
 * no se carga de un CDN, y el WebView no tiene red (lib/pdf-html): un documento
 * privado no sale del telefono.
 */

/** Una URL firmada lleva parametros detras, asi que no basta con endsWith(".pdf"). */
export function isPdfMedia(media) {
  const url = media?.signedUrl || media?.url || "";
  return media?.mimeType === "application/pdf" || media?.kind === "SCAN_PDF" || /\.pdf(\?|#|$)/i.test(url);
}

/**
 * Baja el PDF a la cache una vez por archivo. La URL firmada cambia en cada
 * recarga del item, pero el archivo es el mismo: por eso la clave es el id.
 */
function usePdfFile(media) {
  const url = media?.signedUrl || media?.url || "";
  const id = String(media?.id || url).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);

  return useQuery({
    queryKey: ["pdf-file", id],
    enabled: Boolean(url),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
      const directory = new Directory(Paths.cache, PDF_CACHE_DIRECTORY);
      directory.create({ intermediates: true, idempotent: true });

      const file = new File(directory, id + ".pdf");
      if (!file.exists) {
        // A un nombre temporal y se mueve al acabar: si la descarga se corta
        // (red, app cerrada), Android deja el archivo a medias, y con el
        // nombre definitivo se reutilizaria roto en cada apertura.
        const partial = new File(directory, id + ".part");
        try {
          await File.downloadFileAsync(url, partial, { idempotent: true });
          await partial.move(file);
        } catch (error) {
          if (partial.exists) partial.delete();
          throw error;
        }
      }

      return { file, base64: await file.base64() };
    },
  });
}

function PdfPages({ base64, thumbnail = false, background, onReady, onError }) {
  // ~1,8 MB de pdf.js + el PDF: se arma una vez por documento, no en cada render.
  const html = useMemo(
    () => buildPdfHtml({ base64, thumbnail, background, libraryBase64: PDFJS_LIBRARY_BASE64, workerBase64: PDFJS_WORKER_BASE64 }),
    [base64, thumbnail, background]
  );

  return (
    <WebView
      originWhitelist={[PDF_VIEWER_ORIGIN, "about:*", "blob:*", "data:*"]}
      source={{ html, baseUrl: PDF_VIEWER_ORIGIN }}
      onShouldStartLoadWithRequest={(request) => isAllowedPdfViewerNavigation(request.url)}
      style={{ flex: 1, backgroundColor: background }}
      scrollEnabled={!thumbnail}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      cacheEnabled={false}
      incognito
      onMessage={(event) => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.type === "ready") onReady?.(message.pages);
          if (message.type === "error") onError?.(message.message);
        } catch {
          // Mensaje que no es nuestro: se ignora.
        }
      }}
    />
  );
}

/**
 * Vista previa de la primera pagina, para la tarjeta del item. Mientras baja o
 * si no se puede dibujar, queda el icono de documento.
 */
export function PdfThumbnail({ media, height = 220 }) {
  const pdf = usePdfFile(media);
  const [pages, setPages] = useState(null);
  const [failed, setFailed] = useState(false);
  const palette = brand.palette;

  const showPages = pdf.data && !failed;

  return (
    <View style={{ height, backgroundColor: palette.media }}>
      {showPages ? (
        // El toque lo recoge la tarjeta de fuera, no el WebView.
        <View pointerEvents="none" style={{ flex: 1 }}>
          <PdfPages
            base64={pdf.data.base64}
            thumbnail
            background={palette.media}
            onReady={setPages}
            onError={() => setFailed(true)}
          />
        </View>
      ) : null}

      {!showPages || pages == null ? (
        <View className="absolute inset-0 items-center justify-center gap-2 bg-media">
          {pdf.isLoading || (showPages && pages == null) ? (
            <ActivityIndicator color={brand.primaryColor} />
          ) : (
            <FileText size={40} color={palette.glyph} />
          )}
        </View>
      ) : null}

      <View className="absolute bottom-2.5 left-2.5 flex-row items-center gap-1 rounded-md bg-ink/80 px-2 py-1">
        <FileText size={12} color="#ffffff" />
        <Text className="font-brand-bold text-[11px] uppercase tracking-wide text-white">
          {pages ? `PDF · ${pages} ${pages === 1 ? "page" : "pages"}` : "PDF"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Guarda el PDF fuera de la app. En Android se elige la carpeta (Descargas,
 * por ejemplo) y se escribe ahi; en iOS no hay carpeta publica a la que
 * escribir, asi que se abre el menu del sistema, que trae "Guardar en Archivos".
 */
async function savePdf(file, fileName) {
  if (Platform.OS === "android") {
    const directory = await Directory.pickDirectoryAsync();
    const target = directory.createFile(fileName, "application/pdf");
    target.write(await file.bytes());
    Alert.alert("Saved", fileName + " was saved to the folder you chose.");
    return;
  }

  // Se comparte una copia con el nombre legible: "Guardar en Archivos" usa el
  // nombre del archivo, y el de la cache es el id interno.
  // Dentro de la carpeta de PDFs: se borra con ella al cambiar de cuenta.
  const shareDirectory = new Directory(Paths.cache, PDF_CACHE_DIRECTORY, "share");
  shareDirectory.create({ intermediates: true, idempotent: true });
  const named = new File(shareDirectory, fileName);
  if (named.exists) named.delete();
  await file.copy(named);
  await Sharing.shareAsync(named.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: fileName });
}

export function PdfViewer({ media, title, fileName, onClose }) {
  const insets = useSafeAreaInsets();
  const pdf = usePdfFile(media);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const url = media?.signedUrl || media?.url || "";
  const background = "#1F1E1C";

  const download = async () => {
    if (!pdf.data?.file || saving) return;
    setSaving(true);
    try {
      await savePdf(pdf.data.file, fileName);
    } catch (error) {
      // Cerrar el selector de carpeta tambien llega como error; eso no lo es.
      if (!/cancel/i.test(String(error?.message || error))) {
        Alert.alert("Could not save the PDF", "Please try again in a moment.");
      }
    } finally {
      setSaving(false);
    }
  };

  const error = pdf.isError || failed;

  return (
    <Modal visible={Boolean(media)} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1" style={{ backgroundColor: background }}>
        <View
          className="flex-row items-center gap-3 border-b border-white/10 px-4 pb-3"
          style={{ paddingTop: insets.top + 10 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close PDF"
            onPress={onClose}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:bg-white/25"
          >
            <X size={22} color="#ffffff" />
          </Pressable>

          <Text className="min-w-0 flex-1 font-brand-bold text-[16px] text-white" numberOfLines={1}>
            {title}
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={!pdf.data || saving}
            onPress={download}
            className="flex-row items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2.5 active:opacity-80"
            style={{ opacity: !pdf.data || saving ? 0.6 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Download size={17} color="#ffffff" />}
            <Text className="font-brand-bold text-[14px] text-white">Download</Text>
          </Pressable>
        </View>

        <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
          {pdf.data && !failed ? (
            <PdfPages
              base64={pdf.data.base64}
              background={background}
              onReady={() => setReady(true)}
              onError={() => setFailed(true)}
            />
          ) : null}

          {error ? (
            <View className="absolute inset-0 items-center justify-center gap-4 px-8">
              <FileText size={44} color="#ffffff" />
              <Text className="text-center font-brand-medium text-[15px] text-white">
                This PDF could not be shown here.
              </Text>
              {url ? (
                <Pressable
                  onPress={() => Linking.openURL(url)}
                  className="rounded-[10px] border border-white/30 px-4 py-2.5 active:bg-white/10"
                >
                  <Text className="font-brand-medium text-[14px] text-white">Open outside the app</Text>
                </Pressable>
              ) : null}
            </View>
          ) : !ready ? (
            <View className="absolute inset-0 items-center justify-center">
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
