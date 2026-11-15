import { Directory, Paths } from "expo-file-system";
import { Image } from "expo-image";

import { clearPrivateFiles, PDF_CACHE_DIRECTORY } from "@/lib/private-files";

/** clearPrivateFiles con expo-file-system y expo-image (lib/private-files). */
export function clearPrivateFilesOnDevice() {
  return clearPrivateFiles({
    deletePdfDirectory: () => {
      const directory = new Directory(Paths.cache, PDF_CACHE_DIRECTORY);
      if (directory.exists) directory.delete();
    },
    clearImageDiskCache: () => Image.clearDiskCache(),
    clearImageMemoryCache: () => Image.clearMemoryCache(),
  });
}
