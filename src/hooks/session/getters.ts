/**
 * Expose accessors as reactive getters ON the target object itself. The
 * visible type is the accessor's VALUE type (session.ready, not
 * session.ready()), reads stay transparently reactive inside JSX and
 * createEffect, and the properties are readonly.
 *
 * NOTE: the getters are defined on `target` via defineProperty — callers must
 * NOT spread this object afterwards (spread copies getter values, freezing
 * them).
 */

export function applyGetters<T extends object, A extends Record<string, () => unknown>>(
  target: T,
  accessors: A
): T & { readonly [K in keyof A]: A[K] extends () => infer V ? V : never } {
  const result = target as T & {
    readonly [K in keyof A]: A[K] extends () => infer V ? V : never
  }
  for (const key of Object.keys(accessors) as Array<keyof A>) {
    const accessor = accessors[key]
    Object.defineProperty(result, key, { get: () => accessor(), enumerable: true })
  }
  return result
}
