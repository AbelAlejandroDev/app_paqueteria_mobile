import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Download, FileText, X } from "lucide-react-native";

import { brand } from "@/lib/brand";

/**
 * PDFs del item (los escaneos) vistos dentro de la app.
 *
 * Ni Android ni expo-image saben pintar un PDF, asi que se dibuja con pdf.js
 * dentro de un WebView. El archivo se baja primero con expo-file-system y se le
 * pasa al WebView ya leido: pedirlo desde el WebView dependeria de que el
 * almacenamiento del backend acepte peticiones de otro origen.
 */
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build";

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
      const directory = new Directory(Paths.cache, "item-pdfs");
      directory.create({ intermediates: true, idempotent: true });

      const file = new File(directory, id + ".pdf");
      if (!file.exists) {
        await File.downloadFileAsync(url, file, { idempotent: true });
      }

      return { file, base64: await file.base64() };
    },
  });
}

function buildHtml(base64, { thumbnail, background }) {
  // En miniatura solo la primera pagina, sin margen ni desplazamiento: es una
  // vista previa, el toque lo recoge la tarjeta.
  const padding = thumbnail ? 0 : 12;

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=${thumbnail ? "no" : "yes"}">
<style>
  html, body { margin: 0; padding: 0; background: ${background}; ${thumbnail ? "overflow: hidden;" : ""} }
  #pages { padding: ${padding}px; }
  canvas { display: block; width: 100%; max-width: 100%; height: auto; margin-bottom: ${thumbnail ? 0 : 12}px; background: #fff; ${thumbnail ? "" : "border-radius: 4px;"} }
</style>
</head><body>
<div id="pages"></div>
<script>window.PDF_BASE64 = "${base64}";</script>
<script type="module">
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  try {
    const pdfjs = await import("${PDFJS}/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "${PDFJS}/pdf.worker.min.mjs";

    const raw = atob(window.PDF_BASE64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const container = document.getElementById("pages");
    const width = container.clientWidth - ${padding * 2};
    const ratio = window.devicePixelRatio || 1;
    const count = ${thumbnail ? 1 : "doc.numPages"};

    for (let number = 1; number <= count; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (number === 1) send({ type: "ready", pages: doc.numPages });
    }
  } catch (error) {
    send({ type: "error", message: String((error && error.message) || error) });
  }
</script>
</body></html>`;
}

function PdfPages({ base64, thumbnail = false, background, onReady, onError }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: buildHtml(base64, { thumbnail, background }), baseUrl: "https://cdn.jsdelivr.net" }}
      style={{ flex: 1, backgroundColor: background }}
      scrollEnabled={!thumbnail}
      javaScriptEnabled
      setSupportMultipleWindows={false}
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
        <Text className="font-hanken-bold text-[11px] uppercase tracking-wide text-white">
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

  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: fileName });
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

          <Text className="min-w-0 flex-1 font-hanken-bold text-[16px] text-white" numberOfLines={1}>
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
            <Text className="font-hanken-bold text-[14px] text-white">Download</Text>
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
              <Text className="text-center font-hanken-medium text-[15px] text-white">
                This PDF could not be shown here.
              </Text>
              {url ? (
                <Pressable
                  onPress={() => Linking.openURL(url)}
                  className="rounded-[10px] border border-white/30 px-4 py-2.5 active:bg-white/10"
                >
                  <Text className="font-hanken-medium text-[14px] text-white">Open outside the app</Text>
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
