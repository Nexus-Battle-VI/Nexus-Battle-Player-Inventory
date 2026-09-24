import { Int32 } from 'mongodb'

import {
  ExperienceGrantMappingError,
  documentId,
  fingerprintOf,
  toReplayResult,
  toResult,
  toResultDocument,
  type ExperienceGrantDocument,
} from '../../src/adapters/outbound/persistence/experience-grant-mapping'
import type {
  ExperienceGrantCommand,
  ExperienceGrantResult,
} from '../../src/application/ports/ExperienceGrantPort'

/**
 * Traduccion del asiento del ledger (HU-09, Task HU-09.3).
 *
 * Se prueba SIN contenedor porque es pura, y se prueba sobre todo el camino de
 * LECTURA: un asiento incompleto no debe llegar al llamante disfrazado de
 * acreditacion confirmada, porque un reintento de Missions lo tomaria por bueno.
 */
const OPERATION_ID = 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp'

const commandOf = (overrides: Partial<ExperienceGrantCommand> = {}): ExperienceGrantCommand => ({
  operationId: OPERATION_ID,
  ownerId: 'sub-jugador-1',
  heroId: '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60',
  amount: 250,
  source: {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: 'enr_01JB8Y3K7Q',
    simulationId: 'sim_01JB8Y4B',
    encounterId: '5',
    enemyInstanceId: 'guardian-eterno#1',
    rivalRef: 'guardian-eterno',
    roll: 5,
  },
  ...overrides,
})

const resultOf = (overrides: Partial<ExperienceGrantResult> = {}): ExperienceGrantResult => ({
  operationId: OPERATION_ID,
  applied: true,
  heroId: '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60',
  level: 2,
  currentXp: 250,
  leveledUp: true,
  levelsGained: 1,
  ...overrides,
})

const documentOf = (overrides: Partial<ExperienceGrantDocument> = {}): ExperienceGrantDocument => ({
  _id: OPERATION_ID,
  fingerprint: 'huella',
  ownerId: 'sub-jugador-1',
  heroId: '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60',
  amount: 250,
  roll: 5,
  enrollmentId: 'enr_01JB8Y3K7Q',
  simulationId: 'sim_01JB8Y4B',
  encounterId: '5',
  enemyInstanceId: 'guardian-eterno#1',
  rivalRef: 'guardian-eterno',
  result: toResultDocument(resultOf()),
  createdAt: new Date('2026-10-02T03:00:04.120Z'),
  ...overrides,
})

describe('documentId', () => {
  it('el `_id` del asiento ES el operationId de la derrota', () => {
    expect(documentId(OPERATION_ID)).toBe(OPERATION_ID)
  })
})

describe('fingerprintOf', () => {
  it('el mismo contenido da la misma huella y no depende del orden de las claves', () => {
    const reordered: ExperienceGrantCommand = {
      ...commandOf(),
      source: {
        roll: 5,
        rivalRef: 'guardian-eterno',
        enemyInstanceId: 'guardian-eterno#1',
        encounterId: '5',
        simulationId: 'sim_01JB8Y4B',
        enrollmentId: 'enr_01JB8Y3K7Q',
        kind: 'MISSION_RIVAL_DEFEAT',
      },
    }

    expect(fingerprintOf(reordered)).toBe(fingerprintOf(commandOf()))
  })

  it.each([
    ['el importe', { amount: 999 }],
    ['el heroe', { heroId: 'otro-heroe' }],
    ['el jugador', { ownerId: 'sub-otro' }],
  ])('un %s distinto cambia la huella', (_label, overrides) => {
    expect(fingerprintOf(commandOf(overrides))).not.toBe(fingerprintOf(commandOf()))
  })

  it.each([
    ['la tirada', { roll: 1 }],
    ['el encuentro', { encounterId: '1' }],
    ['la instancia', { enemyInstanceId: 'guardian-eterno#2' }],
    ['el arquetipo', { rivalRef: 'sombra-corrompida' }],
    ['la matriculacion', { enrollmentId: 'enr-otra' }],
    ['la simulacion', { simulationId: 'sim-otra' }],
  ])('un origen con %s distinto cambia la huella', (_label, overrides) => {
    const changed = commandOf({ source: { ...commandOf().source, ...overrides } })

    expect(fingerprintOf(changed)).not.toBe(fingerprintOf(commandOf()))
  })

  it('el operationId NO entra en la huella: ya es la clave del asiento', () => {
    const other = commandOf({ operationId: 'otra-clave' })

    expect(fingerprintOf(other)).toBe(fingerprintOf(commandOf()))
  })
})

describe('toResultDocument', () => {
  it('guarda los siete campos del resultado y nada mas', () => {
    expect(Object.keys(toResultDocument(resultOf())).sort()).toEqual([
      'applied',
      'currentXp',
      'heroId',
      'level',
      'leveledUp',
      'levelsGained',
      'operationId',
    ])
  })

  it('NO guarda el umbral: es derivado y el contrato lo calcula al leer', () => {
    expect(toResultDocument(resultOf())).not.toHaveProperty('nextLevel')
  })

  it('ida y vuelta sin perdida', () => {
    const result = resultOf()

    expect(toResult(toResultDocument(result), OPERATION_ID)).toEqual(result)
  })
})

describe('toResult', () => {
  it('acepta los enteros tal y como los devuelve el driver (`Int32`)', () => {
    const asStored = {
      ...toResultDocument(resultOf()),
      level: new Int32(2),
      currentXp: new Int32(250),
      levelsGained: new Int32(1),
    }

    expect(toResult(asStored, OPERATION_ID)).toMatchObject({
      level: 2,
      currentXp: 250,
      levelsGained: 1,
    })
  })

  it.each([
    ['no es un objeto', 'texto'],
    ['es nulo', null],
    ['es un numero', 42],
  ])('rechaza un resultado que %s', (_label, raw) => {
    expect(() => toResult(raw, OPERATION_ID)).toThrow(ExperienceGrantMappingError)
  })

  it.each([
    ['sin applied booleano', { applied: 'si' }],
    ['sin leveledUp booleano', { leveledUp: 1 }],
    ['con operationId vacio', { operationId: '  ' }],
    ['con heroId vacio', { heroId: '' }],
    ['con nivel 0', { level: 0 }],
    ['con nivel fraccionario', { level: 2.5 }],
    ['con experiencia negativa', { currentXp: -1 }],
    ['con niveles ganados negativos', { levelsGained: -1 }],
  ])('rechaza un asiento corrupto: %s', (_label, overrides) => {
    const raw = { ...toResultDocument(resultOf()), ...(overrides as Record<string, unknown>) }

    expect(() => toResult(raw, OPERATION_ID)).toThrow(ExperienceGrantMappingError)
  })

  it('rechaza un asiento sin el resultado', () => {
    expect(() => toResult(undefined, OPERATION_ID)).toThrow(ExperienceGrantMappingError)
  })
})

describe('toReplayResult', () => {
  it('devuelve el asiento guardado con applied:false: esta llamada no acredito', () => {
    const replay = toReplayResult(documentOf(), OPERATION_ID)

    expect(replay).toEqual({ ...toResultDocument(resultOf()), applied: false })
  })

  it('un asiento cuya clave no es la que se pidio es un error, no un resultado', () => {
    expect(() => toReplayResult(documentOf({ _id: 'otra-clave' }), OPERATION_ID)).toThrow(
      ExperienceGrantMappingError,
    )
  })
})
