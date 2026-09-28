import type { Db } from 'mongodb'

/**
 * El origen de HU-10 en el ledger de experiencia (HU-10, Task HU-10.2;
 * `hu-10-mission-completion-reward-v1` §8).
 *
 * QUE CAMBIA. `009-experience-grants` creo la coleccion con un validador que
 * EXIGE los campos de una derrota (`roll`, `encounterId`, `enemyInstanceId`,
 * `rivalRef`) y prohibe cualquier otro. Una acreditacion de finalizacion no tiene
 * derrota, asi que no cabe. Esta migracion sustituye el validador por un `oneOf`
 * de DOS formas cerradas:
 *
 *   1. `MISSION_RIVAL_DEFEAT` (HU-09): EXACTAMENTE el esquema de `009`, campo por
 *      campo, sin `source`. Los asientos existentes siguen siendo validos y se
 *      leen igual.
 *   2. `MISSION_COMPLETION` (HU-10): el asiento comun mas un subdocumento `source`
 *      con `kind = MISSION_COMPLETION` y SOLO sus campos. Sin `roll`, `rivalRef`,
 *      `enemyInstanceId` ni `encounterId`.
 *
 * NO PUEDE EXISTIR UN ASIENTO A MEDIAS: las dos formas son mutuamente
 * excluyentes (cada una exige lo que la otra prohibe), asi que un asiento de
 * finalizacion con `roll`, o uno de derrota con `source`, lo rechaza el motor.
 *
 * NO SE TOCA NINGUN DOCUMENTO. `collMod` solo cambia el validador para las
 * escrituras futuras; ningun asiento historico se lee, reescribe ni reinterpreta.
 * Es IDEMPOTENTE: aplicarla dos veces deja el mismo validador.
 *
 * Los enteros usan `['int', 'double']` por el mismo motivo que `009`.
 */
const RESULT_SCHEMA = {
  bsonType: 'object',
  required: ['operationId', 'applied', 'heroId', 'level', 'currentXp', 'leveledUp', 'levelsGained'],
  additionalProperties: false,
  properties: {
    operationId: { bsonType: 'string', minLength: 1, maxLength: 300 },
    applied: { bsonType: 'bool' },
    heroId: { bsonType: 'string', minLength: 1, maxLength: 200 },
    level: { bsonType: ['int', 'double'], minimum: 1, maximum: 8 },
    currentXp: { bsonType: ['int', 'double'], minimum: 0 },
    leveledUp: { bsonType: 'bool' },
    levelsGained: { bsonType: ['int', 'double'], minimum: 0 },
  },
} as const

const COMMON_PROPERTIES = {
  _id: { bsonType: 'string', minLength: 1, maxLength: 300 },
  fingerprint: { bsonType: 'string', minLength: 1, maxLength: 2000 },
  ownerId: { bsonType: 'string', minLength: 1 },
  heroId: { bsonType: 'string', minLength: 1 },
  amount: { bsonType: ['int', 'double'], minimum: 0 },
  result: RESULT_SCHEMA,
  createdAt: { bsonType: 'date' },
} as const

const COMMON_REQUIRED = [
  '_id',
  'fingerprint',
  'ownerId',
  'heroId',
  'amount',
  'result',
  'createdAt',
] as const

/** HU-09: el esquema de `009`, sin un solo cambio. */
const RIVAL_DEFEAT_SCHEMA = {
  bsonType: 'object',
  required: [
    ...COMMON_REQUIRED,
    'roll',
    'enrollmentId',
    'simulationId',
    'encounterId',
    'enemyInstanceId',
    'rivalRef',
  ],
  additionalProperties: false,
  properties: {
    ...COMMON_PROPERTIES,
    roll: { bsonType: ['int', 'double'], minimum: 1 },
    enrollmentId: { bsonType: 'string', minLength: 1 },
    simulationId: { bsonType: 'string', minLength: 1 },
    encounterId: { bsonType: 'string', minLength: 1 },
    enemyInstanceId: { bsonType: 'string', minLength: 1 },
    rivalRef: { bsonType: 'string', minLength: 1 },
  },
} as const

/** HU-10: origen de finalizacion como subdocumento cerrado. */
const MISSION_COMPLETION_SCHEMA = {
  bsonType: 'object',
  required: [...COMMON_REQUIRED, 'source'],
  additionalProperties: false,
  properties: {
    ...COMMON_PROPERTIES,
    source: {
      bsonType: 'object',
      required: [
        'kind',
        'enrollmentId',
        'missionId',
        'simulationId',
        'difficulty',
        'missionOutcome',
      ],
      additionalProperties: false,
      properties: {
        kind: { enum: ['MISSION_COMPLETION'] },
        enrollmentId: { bsonType: 'string', minLength: 1 },
        missionId: { bsonType: 'string', minLength: 1 },
        simulationId: { bsonType: 'string', minLength: 1 },
        difficulty: { enum: ['NORMAL', 'HEROIC', 'LEGENDARY', 'MYTHIC'] },
        missionOutcome: { enum: ['COMPLETED', 'FAILED'] },
      },
    },
  },
} as const

export const up = async (db: Db): Promise<void> => {
  await db.command({
    collMod: 'experience_grants',
    validator: { $jsonSchema: { oneOf: [RIVAL_DEFEAT_SCHEMA, MISSION_COMPLETION_SCHEMA] } },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

/**
 * Vuelve al validador de `009`. No borra asientos de HU-10 (el ledger es
 * insert-only): los que existan dejan de poder escribirse pero siguen ahi.
 */
export const down = async (db: Db): Promise<void> => {
  await db.command({
    collMod: 'experience_grants',
    validator: { $jsonSchema: RIVAL_DEFEAT_SCHEMA },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}
