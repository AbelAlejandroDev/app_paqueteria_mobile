import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Image as ImageIcon, X } from "lucide-react-native";

import { Label } from "@/components/ui/input";

const ACCEPTED = ["application/pdf", "image/*"];

function niceSize(bytes) {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB";
}

function Choice({ icon: Icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center gap-1.5 rounded-lg border border-input bg-card py-3 active:bg-muted"
    >
      <Icon size={20} color="#64748b" />
      <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

/**
 * Selector de documento para la verificación USPS.
 *
 * La web solo ofrece <input type="file">. En móvil la cámara es la vía
 * natural: casi nadie tiene un PDF de su carné, pero todos pueden
 * fotografiarlo. Se mantienen las tres opciones porque el Formulario 1583
 * notarizado sí suele llegar como PDF.
 */
export default function DocumentPickerField({ label, value, onChange, required = false }) {
  const [busy, setBusy] = useState(false);

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Sin permiso de cámara", "Actívalo en los ajustes del sistema para poder fotografiar el documento.");
      return;
    }

    setBusy(true);
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled) applyAsset(result.assets[0], "documento.jpg");
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Sin permiso de fotos", "Actívalo en los ajustes del sistema para poder adjuntar una imagen.");
      return;
    }

    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled) applyAsset(result.assets[0], "documento.jpg");
    } finally {
      setBusy(false);
    }
  };

  const pickFromFiles = async () => {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ACCEPTED, copyToCacheDirectory: true });
      if (!result.canceled) {
        const asset = result.assets[0];
        onChange({
          uri: asset.uri,
          name: asset.name || "documento",
          type: asset.mimeType || "application/octet-stream",
          size: asset.size,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const applyAsset = (asset, fallbackName) => {
    onChange({
      uri: asset.uri,
      name: asset.fileName || fallbackName,
      type: asset.mimeType || "image/jpeg",
      size: asset.fileSize,
    });
  };

  return (
    <View className="gap-2">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>

      {value ? (
        <View className="flex-row items-center gap-3 rounded-lg border border-input bg-card px-3 py-3">
          <FileText size={18} color="#64748b" />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {value.name}
            </Text>
            {value.size ? <Text className="text-xs text-muted-foreground">{niceSize(value.size)}</Text> : null}
          </View>
          <Pressable onPress={() => onChange(null)} hitSlop={10} accessibilityLabel={"Quitar " + label}>
            <X size={18} color="#be123c" />
          </Pressable>
        </View>
      ) : (
        <View className="flex-row gap-2" pointerEvents={busy ? "none" : "auto"}>
          <Choice icon={Camera} label="Cámara" onPress={pickFromCamera} />
          <Choice icon={ImageIcon} label="Galería" onPress={pickFromLibrary} />
          <Choice icon={FileText} label="Archivo" onPress={pickFromFiles} />
        </View>
      )}
    </View>
  );
}
