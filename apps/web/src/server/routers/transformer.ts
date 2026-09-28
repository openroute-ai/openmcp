import type { Dinero, DineroSnapshot } from 'dinero.js'
import { dinero } from 'dinero.js'
import superjson from 'superjson'

export type PrimitiveJSONValue = string | number | boolean | undefined | null
export type JSONValue =
  | PrimitiveJSONValue
  | JSONArray
  | { [key: string]: JSONValue }
export type JSONArray = Array<JSONValue>

/**
 * Prices are `Dinero` objects, which JSON cannot represent. Registering the
 * type keeps amounts as exact minor units across the wire instead of forcing
 * every router to serialise them by hand.
 */
superjson.registerCustom(
  {
    isApplicable: (val): val is Dinero<number> => {
      try {
        // If this does not throw it is very likely a Dinero instance.
        ;(val as Dinero<number>).calculator.add(1, 2)
        return true
      } catch {
        return false
      }
    },
    serialize: (val) => {
      return val.toJSON() as JSONValue
    },
    deserialize: (val) => {
      return dinero(val as DineroSnapshot<number>)
    },
  },
  'Dinero'
)

export const transformer = superjson
