import { createContext, useContext, useEffect, useRef } from "react";
import { View } from "react-native";

/**
 * Registro de los elementos reales que el recorrido puede resaltar.
 *
 * Cada pantalla marca el suyo con <TourAnchor id="...">; el recorrido lo mide
 * en el momento (measureInWindow), asi que el resaltado sigue al elemento en
 * cualquier tamaño de pantalla, letra del sistema o barra de navegacion, sin
 * posiciones escritas a mano.
 */
export const TourAnchorContext = createContext(null);

export function TourAnchor({ id, children, style, className }) {
  const register = useContext(TourAnchorContext);
  const ref = useRef(null);

  useEffect(() => {
    if (!register) return undefined;
    return register(id, ref);
  }, [register, id]);

  return (
    // collapsable={false}: Android elimina las vistas que solo agrupan y
    // entonces no habria nada que medir.
    <View ref={ref} collapsable={false} style={style} className={className}>
      {children}
    </View>
  );
}

/** Mide un ancla en coordenadas de ventana. Resuelve null si no esta montada. */
export function measureAnchor(ref) {
  return new Promise((resolve) => {
    const node = ref?.current;
    if (!node?.measureInWindow) {
      resolve(null);
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}
