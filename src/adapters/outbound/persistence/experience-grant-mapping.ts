import type {
  ExperienceGrantCommand,
  ExperienceGrantResult,
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
 * El `source` de la derrota se guarda APLANADO (no como subdocumento) porque sus
 * campos son los que se consultan y se auditan de uno en uno. `kind` no se
 * repite aqui: esta coleccion es del unico origen que hoy existe
 * (`MISSION_RIVAL_DEFEAT`); el dia que haya otro, el campo tendra que viajar y
 * esta decision cambiara con el.
 */
export interface ExperienceGrantDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly ownerId: string
  readonly heroId: string
  readonly amount: number
  readonly roll: number
  readonly enrollmentId: string
  readonly simulationId: string
  readonly encounterId: string
  readonly enemyInstanceId: string
  readonly rivalRef: string
  readonly result: ExperienceGrantResultDocument
  readonly createdAt: Date
}

export const documentId = (operationId: string): string => operationId

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
    source: {
      kind: command.source.kind,
      enrollmentId: command.source.enrollmentId,
      simulationId: command.source.simulationId,
      encounterId: command.source.encounterId,
      enemyInstanceId: command.source.enemyInstanceId,
      rivalRef: command.source.rivalRef,
      roll: command.source.roll,
    },
  })

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
