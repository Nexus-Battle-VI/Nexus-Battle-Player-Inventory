import { DomainError } from '../../domain/errors/DomainError'
import { MAX_HERO_LEVEL } from '../../domain/value-objects/hero-level'
import { experienceRequiredForNextLevel } from '../../domain/policies/ExperiencePolicy'
import { PlayerId } from '../../domain/value-objects/identifiers'
import { ExperienceGrantRejectedError } from '../errors/ApplicationError'
import {
  MISSION_DIFFICULTIES,
  type ExperienceGrantPort,
  type ExperienceGrantSource,
  type GrantHeroExperienceResult,
  type MissionCompletionOutcome,
  type MissionDifficulty,
} from '../ports/ExperienceGrantPort'

/**
 * Acreditacion idempotente de experiencia a un heroe (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * QUE HACE Y QUE NO. Valida el contrato de entrada y delega. **No calcula
 * niveles, no conoce la tabla de umbrales y no redondea**: la aritmetica es de
 * `HeroProgression.awardExperience` (HU-08) y el importe llega ya calculado y
 * entero desde Missions. La atomicidad --ledger y progresion en la misma
 * transaccion-- es del adaptador, igual que en `GrantPurchasedItems`.
 *
 * LO UNICO QUE DERIVA SON `nextLevel` Y `maxLevel`, y lo hace AL LEER: el
 * contrato §7 exige que el umbral se calcule con la tabla vigente y no se
 * almacene. Se derivan del nivel ya acreditado, que es exactamente lo que hace
 * `HeroProgression.thresholdForNextLevel()` por dentro, sin duplicar la regla.
 *
 * EL IMPORTE SE VALIDA AQUI Y NO EN EL DOMINIO, por el codigo que le toca. Un
 * importe fraccionario o negativo tiene que responder `422
 * EXPERIENCE_GRANT_REJECTED` (contrato §7) y no el `400 SCHEMA_INVALID` de un
 * cuerpo mal formado; dejarlo llegar a `Experience` daria un `DomainError` y con
 * el, el 400 equivocado.
 */
export const EXPERIENCE_GRANT_SCHEMA_VERSION = 1

export interface GrantHeroExperienceCommand {
  readonly schemaVersion: number
  /**
   * Clave de la acreditacion. HU-09: `mission:{enrollmentId}:encounter:{...}:hero:{heroId}:xp`;
   * HU-10: `mission:{enrollmentId}:reward:completion:xp`.
   */
  readonly operationId: string
  /** Jugador de la ruta. Identificador opaco del proveedor de identidad. */
  readonly playerId: string
  /** Heroe de la ruta. Identidad canonica (UUID) del producto HEROE. */
  readonly heroId: string
  readonly amount: unknown
  readonly source: unknown
}

export class GrantHeroExperience {
  constructor(private readonly grants: ExperienceGrantPort) {}

  async execute(command: GrantHeroExperienceCommand): Promise<GrantHeroExperienceResult> {
    const grant = requireGrant(command)

    const result = await this.grants.grant(grant)

    return {
      ...result,
      // Derivados en la lectura, nunca persistidos: la tabla de HU-08 se aplica
      // al nivel ya acreditado y el rango maximo es regla de este contexto.
      nextLevel: experienceRequiredForNextLevel(result.level),
      maxLevel: MAX_HERO_LEVEL,
    }
  }
}

/** Valida el contrato y devuelve el comando ya normalizado para el puerto. */
const requireGrant = (command: GrantHeroExperienceCommand) => {
  if (command.schemaVersion !== EXPERIENCE_GRANT_SCHEMA_VERSION) {
    throw new DomainError(`schemaVersion debe ser ${String(EXPERIENCE_GRANT_SCHEMA_VERSION)}.`)
  }

  const operationId = requireText(command.operationId, 'La acreditacion necesita un operationId.')
  const source = requireSource(command.source)

  // La clave de la finalizacion la fija el contrato a partir de la matricula: una
  // clave que no corresponde a la matricula del origen no puede ser esta
  // acreditacion, y aceptarla dejaria dos claves distintas para el mismo derecho.
  if (
    source.kind === 'MISSION_COMPLETION' &&
    operationId !== missionCompletionOperationId(source.enrollmentId)
  ) {
    throw new DomainError(
      `El operationId de una acreditacion MISSION_COMPLETION debe ser ${missionCompletionOperationId(source.enrollmentId)}.`,
    )
  }

  return {
    operationId,
    ownerId: PlayerId.create(command.playerId).value,
    heroId: requireText(command.heroId, 'La acreditacion necesita un heroe.'),
    amount: requireAmount(command.amount),
    source,
  }
}

/**
 * Importe: entero no negativos. `422` y no `400`, porque el cuerpo esta bien
 * formado y lo que incumple es una regla.
 *
 * Un importe de `0` se ACEPTA: la tabla de HU-08 empieza en enteros no negativos
 * y `Experience.add(0)` no rompe nada. Lo que el contrato prohibe es fraccionario
 * o negativo, y eso es lo que se rechaza.
 */
const requireAmount = (raw: unknown): number => {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new ExperienceGrantRejectedError(
      `La experiencia acreditada debe ser un entero no negativo. Se recibio ${describe(raw)}.`,
    )
  }

  return raw
}

/** Campos EXACTOS de cada origen. Un campo de mas o de menos es un cuerpo fuera del contrato. */
const RIVAL_DEFEAT_FIELDS = [
  'kind',
  'enrollmentId',
  'simulationId',
  'encounterId',
  'enemyInstanceId',
  'rivalRef',
  'roll',
] as const

const COMPLETION_FIELDS = [
  'kind',
  'enrollmentId',
  'missionId',
  'simulationId',
  'difficulty',
  'missionOutcome',
] as const

const COMPLETION_OUTCOMES: readonly MissionCompletionOutcome[] = ['COMPLETED', 'FAILED']

/** `operationId` de la XP de finalizacion (`hu-10-mission-completion-reward-v1` §8 y §12). */
export const missionCompletionOperationId = (enrollmentId: string): string =>
  `mission:${enrollmentId}:reward:completion:xp`

/**
 * Origen de la acreditacion: una union discriminada por `kind`. Se comprueba
 * campo a campo porque el cuerpo es de otro servicio: el tipo dice lo que el
 * contrato espera, no lo que llego.
 *
 * CADA VARIANTE ACEPTA EXACTAMENTE SUS CAMPOS. Un `MISSION_COMPLETION` con `roll`,
 * `rivalRef`, `enemyInstanceId` o `encounterId`, o un `MISSION_RIVAL_DEFEAT` sin
 * ellos o con `missionId`, `difficulty` o `missionOutcome`, se rechaza: mezclar
 * variantes seria fabricar una derrota que no existio o una finalizacion sin su
 * mision.
 */
const requireSource = (raw: unknown): ExperienceGrantSource => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DomainError('La acreditacion necesita el origen de la experiencia.')
  }

  const source = raw as Record<string, unknown>

  switch (source.kind) {
    case 'MISSION_RIVAL_DEFEAT':
      return requireRivalDefeatSource(source)
    case 'MISSION_COMPLETION':
      return requireCompletionSource(source)
    default:
      throw new DomainError(
        'El origen de la experiencia debe ser MISSION_RIVAL_DEFEAT o MISSION_COMPLETION.',
      )
  }
}

/** Origen de HU-09. Sin cambios de contrato: solo se comprueba de forma estricta. */
const requireRivalDefeatSource = (source: Record<string, unknown>): ExperienceGrantSource => {
  requireExactFields(source, RIVAL_DEFEAT_FIELDS, 'MISSION_RIVAL_DEFEAT')

  // `roll` se exige entero y al menos `1`, pero **no se le pone techo**: el dado es
  // de Combat (`1d8`, HU-09.2) y Player/Inventory no conoce su numero de caras.
  // Acotarlo aqui seria duplicar una regla ajena, y ademas el `roll` es
  // trazabilidad: el importe ya viene calculado.
  if (typeof source.roll !== 'number' || !Number.isInteger(source.roll) || source.roll < 1) {
    throw new DomainError(
      `La tirada del origen debe ser un entero mayor o igual que 1. Se recibio ${describe(source.roll)}.`,
    )
  }

  return {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: requireText(source.enrollmentId, 'El origen necesita un enrollmentId.'),
    simulationId: requireText(source.simulationId, 'El origen necesita un simulationId.'),
    encounterId: requireText(source.encounterId, 'El origen necesita un encounterId.'),
    enemyInstanceId: requireText(source.enemyInstanceId, 'El origen necesita un enemyInstanceId.'),
    rivalRef: requireText(source.rivalRef, 'El origen necesita un rivalRef.'),
    roll: source.roll,
  }
}

/**
 * Origen de HU-10: la finalizacion de la mision. No hay derrota, ni tirada, ni
 * encuentro. `difficulty` y `missionOutcome` se validan por su vocabulario
 * cerrado (HU-75 y HU-10): es validar la FORMA, no decidir nada -- ni cuanta
 * experiencia corresponde a cada dificultad, ni si el desenlace da derecho.
 */
const requireCompletionSource = (source: Record<string, unknown>): ExperienceGrantSource => {
  requireExactFields(source, COMPLETION_FIELDS, 'MISSION_COMPLETION')

  return {
    kind: 'MISSION_COMPLETION',
    enrollmentId: requireText(source.enrollmentId, 'El origen necesita un enrollmentId.'),
    missionId: requireText(source.missionId, 'El origen necesita un missionId.'),
    simulationId: requireText(source.simulationId, 'El origen necesita un simulationId.'),
    difficulty: requireOneOf<MissionDifficulty>(
      source.difficulty,
      MISSION_DIFFICULTIES,
      'La dificultad del origen',
    ),
    missionOutcome: requireOneOf<MissionCompletionOutcome>(
      source.missionOutcome,
      COMPLETION_OUTCOMES,
      'El desenlace del origen',
    ),
  }
}

/** Rechaza cualquier clave que la variante no declara, y exige todas las que si. */
const requireExactFields = (
  source: Record<string, unknown>,
  allowed: readonly string[],
  kind: string,
): void => {
  const unexpected = Object.keys(source).filter((key) => !allowed.includes(key))

  if (unexpected.length > 0) {
    throw new DomainError(
      `El origen ${kind} no admite los campos: ${unexpected.join(', ')}. Solo ${allowed.join(', ')}.`,
    )
  }

  const missing = allowed.filter((key) => source[key] === undefined)

  if (missing.length > 0) {
    throw new DomainError(`El origen ${kind} necesita los campos: ${missing.join(', ')}.`)
  }
}

const requireOneOf = <T extends string>(raw: unknown, allowed: readonly T[], label: string): T => {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new DomainError(
      `${label} debe ser uno de ${allowed.join(', ')}. Se recibio ${describe(raw)}.`,
    )
  }

  return raw as T
}

/**
 * Rechaza cadenas vacias o en blanco, sin recortar por sorpresa.
 *
 * NO se pliega el caso, a diferencia de `GrantPurchasedItems`: alli la clave es
 * un UUID --que da igual en mayusculas o minusculas-- y aqui lleva dentro
 * referencias de arquetipo (`guardian-eterno#1`) que no tienen por que ser
 * insensibles al caso. Plegarlas podria fundir dos derrotas distintas en una.
 */
const requireText = (raw: unknown, message: string): string => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DomainError(message)
  }

  return raw.trim()
}

/** Representacion legible de un valor rechazado, sin volcar objetos enteros. */
const describe = (raw: unknown): string => {
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return `"${raw}"`
  if (raw === null) return 'null'
  return typeof raw
}
