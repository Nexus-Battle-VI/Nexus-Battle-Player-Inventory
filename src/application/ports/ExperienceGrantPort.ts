import type { ExperienceThreshold } from '../../domain/policies/ExperiencePolicy'

/**
 * Puerto de la acreditacion idempotente de experiencia (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * QUIEN ESCRIBE EL ESTADO DEL HEROE ES SU DUENO (`ADR-019`). Missions no puede
 * tocar el almacen de Player/Inventory: pide la acreditacion por esta operacion,
 * que es el unico camino por el que la experiencia entra en un heroe.
 *
 * LA CLAVE ES EL `operationId` DE LA DERROTA, no el de la mision:
 * `mission:{enrollmentId}:encounter:{encounterId}:enemy:{enemyInstanceId}:hero:{heroId}:xp`.
 * Se invoca UNA VEZ POR CADA ENEMIGO DERROTADO, con su clave. Si se llamara una
 * sola vez con la suma de varias derrotas, un reintento parcial no se podria
 * distinguir de una recompensa nueva y la traza por derrota se perderia.
 *
 * LA ATOMICIDAD ES DEL ADAPTADOR, como en `InventoryGrantPort` (HU-59): este
 * puerto no promete transaccion, la implementacion la hace. El caso de uso que
 * lo consume solo valida y delega.
 */

/** Origen de la experiencia acreditada: la derrota concreta de la que sale. */
export interface ExperienceGrantSource {
  /**
   * Unico origen implementado hoy. Va en el puerto para que el dia que exista
   * otro (HU-10, recompensa por mision completada) el contrato lo diga en vez de
   * deducirse del nombre de la coleccion.
   */
  readonly kind: 'MISSION_RIVAL_DEFEAT'
  readonly enrollmentId: string
  readonly simulationId: string
  /** Encuentro dentro de la mision. */
  readonly encounterId: string
  /** Instancia concreta del enemigo: `<enemyRef>#<n>`. */
  readonly enemyInstanceId: string
  /** Arquetipo del enemigo. Trazabilidad; no identifica la derrota. */
  readonly rivalRef: string
  /** Cara del dado que produjo el importe. Trazabilidad; el importe ya viene calculado. */
  readonly roll: number
}

export interface ExperienceGrantCommand {
  /** Clave de idempotencia de ESTA derrota. Es el `_id` del ledger. */
  readonly operationId: string
  /** Jugador dueno del heroe. Llega de la ruta, firmada por el llamante. */
  readonly ownerId: string
  /** Identidad canonica (UUID) del producto HEROE. */
  readonly heroId: string
  /** Experiencia a acreditar: ENTERA y no negativa. La formula es de Missions. */
  readonly amount: number
  readonly source: ExperienceGrantSource
}

/**
 * Resultado persistido de una acreditacion.
 *
 * SE GUARDA ENTERO EN EL LEDGER, y por eso NO lleva `nextLevel` ni `maxLevel`:
 * son derivados del nivel y la Task HU-09.1 exige que se calculen en la lectura,
 * no que se almacenen. Guardarlos crearia un valor que puede quedar
 * desincronizado con la tabla de HU-08.
 *
 * `applied` NO es parte del estado guardado: significa "esta llamada acredito" y
 * en un replay vale `false`. El ledger guarda la acreditacion con `applied:
 * true` y el adaptador lo corrige al devolverla repetida.
 */
export interface ExperienceGrantResult {
  readonly operationId: string
  readonly applied: boolean
  readonly heroId: string
  /** Nivel del heroe DESPUES de acreditar. */
  readonly level: number
  /** Experiencia ACUMULADA despues de acreditar. Solo crece. */
  readonly currentXp: number
  readonly leveledUp: boolean
  /** Cuantos niveles se cruzaron con ESTA acreditacion. Puede ser 0 o mas de 1. */
  readonly levelsGained: number
}

/** Resultado que devuelve el caso de uso: lo persistido mas lo derivado al leer. */
export interface GrantHeroExperienceResult extends ExperienceGrantResult {
  /** Umbral del siguiente nivel, o `MAX_LEVEL`. Derivado con la tabla de HU-08. */
  readonly nextLevel: ExperienceThreshold
  readonly maxLevel: number
}

export interface ExperienceGrantPort {
  /**
   * Acredita la experiencia de una derrota, una sola vez por `operationId`.
   *
   * Mismo `operationId` y mismo contenido: devuelve el resultado guardado con
   * `applied: false`, sin volver a acreditar. Mismo `operationId` con otro
   * contenido: `ExperienceGrantConflictError` (`409`), sin sobrescribir nada.
   */
  grant(command: ExperienceGrantCommand): Promise<ExperienceGrantResult>
}

export const EXPERIENCE_GRANTS = Symbol('ExperienceGrantPort')
