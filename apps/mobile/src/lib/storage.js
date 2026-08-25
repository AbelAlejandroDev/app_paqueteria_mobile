import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { configureStorage } from "@paqueteria/core";

/**
 * Backend de almacenamiento para móvil.
 *
 * - Tokens (`secure`): Keychain en iOS / Keystore en Android vía expo-secure-store.
 * - Resto: AsyncStorage, que no tiene límite práctico de tamaño.
 *
 * En web SecureStore no existe, así que todo cae a AsyncStorage (que allí es
 * localStorage). Solo aplica a `expo start --web` durante el desarrollo.
 */

const asyncStorageBackend = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

const secureStoreBackend = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export function setupStorage() {
  configureStorage({
    ...asyncStorageBackend,
    secure: Platform.OS === "web" ? asyncStorageBackend : secureStoreBackend,
  });
}
