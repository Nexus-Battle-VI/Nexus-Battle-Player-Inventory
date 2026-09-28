import {
  MISSION_DIFFICULTIES,
  type ExperienceGrantCommand,
  type ExperienceGrantResult,
  type ExperienceGrantSource,
} from '../../../application/ports/ExperienceGrantPort'

/**
 * Traduccion entre el asiento del ledger y sus instantaneas (HU-09, Task
 * HU-09.3). Pura y aparte del repositorio, como `hero-progression-mapping`: es
 * donde uno se puede equivocar de verdad --un `Int32` sin desempaquetar, un
 * `applied` que no es booleano, un resultado a medias-- y sacarla permite
 * probarla sin contenedor.
 *
 * VALIDA AL LEER, NO SOLO AL ESCRIBIR. Un asiento corrupto no debe llegar al
 * llamante disfrazado de acreditacion confirmada: si el `result` guardado no se
 * puede reconstruir, se dice, en lugar de devolver una respuesta inventada a un
 * reintento de Missions.
 *
 * EL LEDGER NO GUARDA `nextLevel` NI `maxLevel`. Son derivados del nivel y el
 * contrato §7 exige calcularlos en la lectura: persistirlos crearia un valor que
 * puede quedar desincronizado con la tabla de HU-08.
 */

export class ExperienceGrantMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExperienceGrantMappingError'
  }
}

/** Resultado de una acreditacion tal y como se guarda en el ledger. */
export interface ExperienceGrantResultDocument {
  readonly operationId: string
  readonly applied: boolean
  readonly heroId: string
  readonly level: number
  readonly currentXp: number
  readonly leveledUp: boolean
  readonly levelsGained: number
}

/**
 * Asiento del ledger de acreditaciones de experiencia.
 *
 * `_id` ES el `operationId` de la derrota: es, por construccion, la clave de
 * idempotencia. MongoDB garantiza su unicidad sin indice adicional.
 *
 * DOS FORMAS, UN DISCRIMINADOR IMPLICITO (HU-10.2). Las acreditaciones de HU-09
 * (`MISSION_RIVAL_DEFEAT`) se guardaron desde el principio con el origen
 * APLANADO y SIN campo `kind`; reescribirlas o reinterpretarlas seria tocar
 * historia. Por eso:
 *
 *   - una acreditacion de HU-09 se sigue escribiendo y leyendo EXACTAMENTE igual
 *     (`RivalDefeatGrantDocument`): campos planos, sin `source`;
 *   - una de HU-10 (`MISSION_COMPLETION`) se guarda con un subdocumento `source`
 *     que lleva su `kind` y SOLO sus campos (`MissionCompletionGrantDocument`).
 *
 * El discriminador es la presencia de `source`: un asiento con `source` es de
 * HU-10 y sin el es de HU-09. El validador de la coleccion (migracion `014`) es
 * un `oneOf` de las dos formas, asi que no puede existir un asiento que mezcle
 * campos de derrota con un origen de finalizacion.
 */
interface GrantDocumentBase {
  readonly _id: string
  readonly fingerprint: string
  readonly ownerId: string
  readonly heroId: string
  readonly amount: number
  readonly result: ExperienceGrantResultDocument
  readonly createdAt: Date
}

/** HU-09: origen aplanado, sin `kind` ni `source`. Forma historica, intacta. */
export interface RivalDefeatGrantDocument extends GrantDocumentBase {
  readonly roll: number
  readonly enrollmentId: string
  readonly simulationId: string
  readonly encounterId: string
  readonly enemyInstanceId: string
  readonly rivalRef: string
}

/** Origen de HU-10 tal como se guarda: solo sus campos, con su `kind`. */
export interface MissionCompletionSourceDocument {
  readonly kind: 'MISSION_COMPLETION'
  readonly enrollmentId: string
  readonly missionId: string
  readonly simulationId: string
  readonly difficulty: string
  readonly missionOutcome: string
}

/** HU-10: origen como subdocumento discriminado. */
export interface MissionCompletionGrantDocument extends GrantDocumentBase {
  readonly source: MissionCompletionSourceDocument
}

export type ExperienceGrantDocument = RivalDefeatGrantDocument | MissionCompletionGrantDocument

export const documentId = (operationId: string): string => operationId

/**
 * El asiento que se inserta para un comando ya validado. Lo comparten el
 * adaptador de MongoDB y el de memoria: la traduccion vive en un solo sitio.
 */
export const toLedgerDocument = (
  command: ExperienceGrantCommand,
  fingerprint: string,
  result: ExperienceGrantResult,
  createdAt: Date,
): ExperienceGrantDocument => {
  const base: GrantDocumentBase = {
    _id: documentId(command.operationId),
    fingerprint,
    ownerId: command.ownerId,
    heroId: command.heroId,
    amount: command.amount,
    result: toResultDocument(result),
    createdAt,
  }
  const { source } = command

  if (source.kind === 'MISSION_COMPLETION') {
    return {
      ...base,
      source: {
        kind: 'MISSION_COMPLETION',
        enrollmentId: source.enrollmentId,
        missionId: source.missionId,
        simulationId: source.simulationId,
        difficulty: source.difficulty,
        missionOutcome: source.missionOutcome,
      },
    }
  }

  return {
    ...base,
    roll: source.roll,
    enrollmentId: source.enrollmentId,
    simulationId: source.simulationId,
    encounterId: source.encounterId,
    enemyInstanceId: source.enemyInstanceId,
    rivalRef: source.rivalRef,
  }
}

/**
 * El origen de un asiento guardado, valido y con su `kind`. Un asiento historico
 * de HU-09 (sin `source`) se lee como `MISSION_RIVAL_DEFEAT`; uno de HU-10 con
 * su subdocumento, como `MISSION_COMPLETION`. Un asiento a medias -- de HU-10 con
 * campos de derrota, o de HU-09 incompleto -- lanza en lugar de inventar un origen.
 */
export const toSource = (document: ExperienceGrantDocument): ExperienceGrantSource => {
  if ('source' in document) {
    const raw = document.source as unknown as Record<string, unknown>

    if (raw.kind !== 'MISSION_COMPLETION') {
      throw new ExperienceGrantMappingError(
        `El origen del asiento ${document._id} no es un MISSION_COMPLETION valido.`,
      )
    }

    const difficulty = requireOneOf(raw.difficulty, MISSION_DIFFICULTIES, 'La dificultad')

    if (raw.missionOutcome !== 'COMPLETED' && raw.missionOutcome !== 'FAILED') {
      throw new ExperienceGrantMappingError(
        `El desenlace del asiento ${document._id} debe ser COMPLETED o FAILED.`,
      )
    }

    return {
      kind: 'MISSION_COMPLETION',
      enrollmentId: requireText(raw.enrollmentId, `El enrollmentId del asiento ${document._id}`),
      missionId: requireText(raw.missionId, `El missionId del asiento ${document._id}`),
      simulationId: requireText(raw.simulationId, `El simulationId del asiento ${document._id}`),
      difficulty,
      missionOutcome: raw.missionOutcome,
    }
  }

  return {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: requireText(document.enrollmentId, `El enrollmentId del asiento ${document._id}`),
    simulationId: requireText(document.simulationId, `El simulationId del asiento ${document._id}`),
    encounterId: requireText(document.encounterId, `El encounterId del asiento ${document._id}`),
    enemyInstanceId: requireText(
      document.enemyInstanceId,
      `El enemyInstanceId del asiento ${document._id}`,
    ),
    rivalRef: requireText(document.rivalRef, `El rivalRef del asiento ${document._id}`),
    roll: requireInteger(document.roll, `La tirada del asiento ${document._id}`, 1),
  }
}

const requireOneOf = <T extends string>(raw: unknown, allowed: readonly T[], label: string): T => {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new ExperienceGrantMappingError(`${label} debe ser uno de ${allowed.join(', ')}.`)
  }

  return raw as T
}

/**
 * Huella del CONTENIDO de la acreditacion: es lo que decide entre devolver el
 * resultado guardado (mismo contenido) y `409` (contenido distinto).
 *
 * Se construye a partir del comando YA NORMALIZADO --identificadores recortados
 * y validados por el caso de uso--, no del cuerpo crudo de la peticion. Si se
 * calculara sobre el crudo, dos peticiones equivalentes con las claves en otro
 * orden o con espacios de mas darian huellas distintas y la segunda se
 * rechazaria con un `409` falso.
 */
export const fingerprintOf = (command: ExperienceGrantCommand): string =>
  JSON.stringify({
    ownerId: command.ownerId,
    heroId: command.heroId,
    amount: command.amount,
    source: fingerprintSourceOf(command.source),
  })

/**
 * Los datos SEMANTICOS de cada variante, y solo los suyos. La forma de
 * `MISSION_RIVAL_DEFEAT` es BYTE A BYTE la que se uso siempre: las huellas de los
 * asientos historicos de HU-09 tienen que seguir coincidiendo con las de un
 * reintento actual, o un replay legitimo se volveria un `409`. La de
 * `MISSION_COMPLETION` no lleva ningun campo de derrota ni la de HU-09 uno de
 * finalizacion, de modo que dos variantes nunca comparten huella.
 */
const fingerprintSourceOf = (source: ExperienceGrantSource): Record<string, unknown> =>
  source.kind === 'MISSION_COMPLETION'
    ? {
        kind: source.kind,
        enrollmentId: source.enrollmentId,
        missionId: source.missionId,
        simulationId: source.simulationId,
        difficulty: source.difficulty,
        missionOutcome: source.missionOutcome,
      }
    : {
        kind: source.kind,
        enrollmentId: source.enrollmentId,
        simulationId: source.simulationId,
        encounterId: source.encounterId,
        enemyInstanceId: source.enemyInstanceId,
        rivalRef: source.rivalRef,
        roll: source.roll,
      }

const requireInteger = (raw: unknown, context: string, min: number): number => {
  const value = typeof raw === 'number' ? raw : unwrapBsonInteger(raw)

  if (value === null || !Number.isInteger(value) || value < min) {
    throw new ExperienceGrantMappingError(
      `${context} debe ser un entero mayor o igual que ${String(min)}: ${String(raw)}.`,
    )
  }

  return value
}

/** El driver devuelve `Int32` para los campos declarados `int` en el validador. */
const unwrapBsonInteger = (raw: unknown): number | null => {
  if (typeof raw === 'object' && raw !== null && 'valueOf' in raw) {
    const value = (raw as { valueOf: () => unknown }).valueOf()

    return typeof value === 'number' ? value : null
  }

  return null
}

const requireText = (raw: unknown, context: string): string => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ExperienceGrantMappingError(`${context} debe ser una cadena con contenido.`)
  }

  return raw
}

const requireBoolean = (raw: unknown, context: string): boolean => {
  if (typeof raw !== 'boolean') {
    throw new ExperienceGrantMappingError(`${context} debe ser booleano.`)
  }

  return raw
}

export const toResultDocument = (result: ExperienceGrantResult): ExperienceGrantResultDocument => ({
  operationId: result.operationId,
  applied: result.applied,
  heroId: result.heroId,
  level: result.level,
  currentXp: result.currentXp,
  leveledUp: result.leveledUp,
  levelsGained: result.levelsGained,
})

/** Reconstruye el resultado guardado. Lanza si el asiento esta incompleto. */
export const toResult = (raw: unknown, operationId: string): ExperienceGrantResult => {
  if (typeof raw !== 'object' || raw === null) {
    throw new ExperienceGrantMappingError(
      `El asiento ${operationId} no guarda el resultado de la acreditacion.`,
    )
  }

  const result = raw as Record<string, unknown>

  return {
    operationId: requireText(result.operationId, `El operationId del asiento ${operationId}`),
    applied: requireBoolean(result.applied, `El applied del asiento ${operationId}`),
    heroId: requireText(result.heroId, `El heroId del asiento ${operationId}`),
    level: requireInteger(result.level, `El nivel del asiento ${operationId}`, 1),
    currentXp: requireInteger(result.currentXp, `La experiencia del asiento ${operationId}`, 0),
    leveledUp: requireBoolean(result.leveledUp, `El leveledUp del asiento ${operationId}`),
    levelsGained: requireInteger(
      result.levelsGained,
      `Los niveles ganados del asiento ${operationId}`,
      0,
    ),
  }
}

/** Comprueba que el `_id` del asiento es el `operationId` que se pidio. */
export const requireDocumentId = (document: ExperienceGrantDocument, operationId: string): void => {
  if (document._id !== operationId) {
    throw new ExperienceGrantMappingError(
      `El asiento ${operationId} se guardo con la clave ${document._id}.`,
    )
  }
}

/**
 * El asiento guardado, listo para devolverlo en un reintento.
 *
 * Vive aqui y no en el repositorio porque es traduccion pura: valida el
 * documento y corrige `applied`, que significa "esta llamada acredito" y en un
 * reintento vale `false` aunque el asiento se guardara con `true`.
 */
export const toReplayResult = (
  document: Pick<ExperienceGrantDocument, '_id' | 'result'>,
  operationId: string,
): ExperienceGrantResult => {
  requireDocumentId(document as ExperienceGrantDocument, operationId)

  return { ...toResult(document.result, operationId), applied: false }
}
