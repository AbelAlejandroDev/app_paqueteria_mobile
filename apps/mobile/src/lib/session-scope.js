/**
 * A quien pertenecen los datos en memoria: organizacion y usuario.
 *
 * La cache de React Query y la navegacion pendiente de un push son de una
 * cuenta concreta. Cuando cambia este valor (cierre de sesion, otra persona,
 * la misma persona en otra organizacion) hay que tirarlas antes de pintar nada
 * de la cuenta nueva.
 */
export function sessionScope(user) {
  if (!user?.id) return null;
  const tenant = user.tenantId || user.tenant?.id || user.tenant?.slug || "no-tenant";
  return tenant + ":" + user.id;
}

/**
 * Si pasar de `previous` a `next` obliga a vaciar los datos privados.
 *
 * `previous` es `undefined` solo en el arranque, antes de saber nada: ahi no hay
 * datos de nadie que tirar. Despues, cualquier cambio de ambito vacia, tambien
 * hacia `null` (cerrar sesion).
 */
export function scopeChangeRequiresReset(previous, next) {
  if (previous === undefined) return false;
  return previous !== next;
}

/**
 * Sigue el ambito de la sesion y llama a `onReset(next, previous)` cada vez que
 * cambia (salvo el primer valor, en el arranque). Devuelve `track(user)`.
 *
 * Es una funcion y no un efecto de React para que el vaciado ocurra en el
 * mismo instante del cambio, antes de pintar a la cuenta nueva.
 */
export function createScopeTracker(onReset) {
  let current;
  return function track(user) {
    const next = sessionScope(user);
    if (scopeChangeRequiresReset(current, next)) onReset(next, current);
    current = next;
    return next;
  };
}

/**
 * Vacia la cache de React Query. Primero cancela lo que este en vuelo: una
 * respuesta de la cuenta anterior que llegara despues no puede quedarse en la
 * cache de la siguiente.
 */
export function resetQueryCache(queryClient) {
  queryClient.cancelQueries();
  queryClient.clear();
}
