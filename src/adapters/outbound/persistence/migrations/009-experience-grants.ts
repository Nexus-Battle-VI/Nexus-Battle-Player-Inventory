import type { Db } from 'mongodb'

/**
 * Ledger de acreditaciones de experiencia al heroe (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * POR QUE UN LEDGER Y NO SOLO LA PROGRESION. La progresion guarda el acumulado;
 * el ledger guarda QUE ACREDITACIONES lo produjeron. Sin el, un reintento de
 * Missions --la semantica de entrega es "al menos una vez"-- volveria a sumar la
 * misma recompensa y no habria forma de distinguir un reintento de una derrota
 * nueva. `_id = operationId` es la clave de idempotencia y la unicidad la
 * garantiza el motor, no una comprobacion de la aplicacion que se pueda olvidar.
 *
 * EL LEDGER NO GUARDA `nextLevel` NI `maxLevel`. Son derivados del nivel y el
 * contrato §7 exige calcularlos en la lectura: persistirlos crearia un valor que
 * puede quedar desincronizado con la tabla de HU-08. Aqui solo esta el resultado
 * de la acreditacion, que es lo que un reintento tiene que devolver TAL CUAL.
 *
 * LA PROGRESION NO SE TOCA AQUI. `009` solo crea esta coleccion; el documento de
 * `hero-progressions` sigue siendo el de `008` y su `_id` compuesto
 * (`"<ownerId>::<heroId>"`). Las dos escrituras van en la MISMA transaccion, pero
 * eso es del repositorio, no del esquema.
 *
 * LOS ENTEROS USAN `['int', 'double']` Y NO `'int'`, por el mismo motivo que
 * documenta la migracion `011` de Combat: el driver escribe los numeros de
 * JavaScript como `double` salvo que se envuelvan en `Int32`, y exigir `'int'`
 * haria fallar la escritura del propio repositorio. La integralidad de lo que se
 * lee la comprueba ademas `experience-grant-mapping`.
 *
 * ADITIVA: no toca ninguna coleccion existente ni reescribe ningun documento.
 */
const RESULT_SCHEMA = {
  bsonType: 'object',
  required: ['operationId', 'applied', 'heroId', 'level', 'currentXp', 'leveledUp', 'levelsGained'],
  additionalProperties: false,
  properties: {
    operationId: { bsonType: 'string', minLength: 1, maxLength: 300 },
    /** `true` en el asiento: significa "esta acreditacion se aplico". */
    applied: { bsonType: 'bool' },
    heroId: { bsonType: 'string', minLength: 1, maxLength: 200 },
    level: { bsonType: ['int', 'double'], minimum: 1, maximum: 8 },
    /** Experiencia ACUMULADA. Sin techo: el heroe sigue acumulando en el nivel 8. */
    currentXp: { bsonType: ['int', 'double'], minimum: 0 },
    leveledUp: { bsonType: 'bool' },
    /** Niveles cruzados con esta acreditacion: 0, o mas de 1 si el acumulado lo permite. */
    levelsGained: { bsonType: ['int', 'double'], minimum: 0 },
  },
} as const

export const up = async (db: Db): Promise<void> => {
  await db.createCollection('experience_grants', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          '_id',
          'fingerprint',
          'ownerId',
          'heroId',
          'amount',
          'roll',
          'enrollmentId',
          'simulationId',
          'encounterId',
          'enemyInstanceId',
          'rivalRef',
          'result',
          'createdAt',
        ],
        additionalProperties: false,
        properties: {
          /**
           * El `operationId` de la DERROTA, no el de la mision:
           * `mission:{enrollmentId}:encounter:{encounterId}:enemy:{enemyInstanceId}:hero:{heroId}:xp`.
           */
          _id: { bsonType: 'string', minLength: 1, maxLength: 300 },
          /** Huella del contenido: distingue el reintento (`200`) del conflicto (`409`). */
          fingerprint: { bsonType: 'string', minLength: 1, maxLength: 2000 },
          ownerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          amount: { bsonType: ['int', 'double'], minimum: 0 },
          /** Cara del dado que produjo el importe. Trazabilidad; el dado es de Combat. */
          roll: { bsonType: ['int', 'double'], minimum: 1 },
          enrollmentId: { bsonType: 'string', minLength: 1 },
          simulationId: { bsonType: 'string', minLength: 1 },
          encounterId: { bsonType: 'string', minLength: 1 },
          enemyInstanceId: { bsonType: 'string', minLength: 1 },
          /** Arquetipo del enemigo: trazabilidad; no identifica la derrota. */
          rivalRef: { bsonType: 'string', minLength: 1 },
          result: RESULT_SCHEMA,
          createdAt: { bsonType: 'date' },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })

  // Sin indices secundarios: todo se consulta por `_id`, que el motor ya indexa.
  // El ledger no se barre por estado ni se lista por jugador: es la prueba de que
  // una acreditacion concreta ya se aplico, y se pregunta por su clave.
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('experience_grants').drop()
}
