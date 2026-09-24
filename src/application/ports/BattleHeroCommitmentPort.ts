/**
 * Compromiso de batalla del heroe (HU-29, contrato
 * `hu-29-battle-commitment-v1`).
 *
 * Mientras el compromiso esta `ACTIVE` y no ha vencido, el heroe esta «en
 * batalla»: su loadout queda bloqueado. El ciclo de vida de la batalla es de
 * Combat; aqui solo se guarda la marca de ocupacion que Combat publica.
 *
 * La clave estable es el `operationId` del llamador, igual que en el compromiso
 * de mision: un reintento con la misma clave devuelve el mismo compromiso, y con
 * otro contenido es un conflicto.
 */
export interface BattleHeroCommitmentInput {
  readonly operationId: string
  readonly playerId: string
  readonly heroId: string
  /** Referencia del llamador: el `roomId` de la batalla. Traza, no clave. */
  readonly reference: string
  /** Hasta cuando vale. Obligatorio: es lo que impide un bloqueo permanente. */
  readonly expiresAt: Date
}

export interface BattleHeroCommitment extends BattleHeroCommitmentInput {
  readonly commitmentId: string
  readonly status: 'ACTIVE' | 'RELEASED'
}

export interface BattleHeroCommitmentPort {
  findByOperation(operationId: string): Promise<BattleHeroCommitment | null>
  /** `true` si el heroe tiene un compromiso vigente en `now`. Es lo que lee el guard. */
  hasActiveForHero(playerId: string, heroId: string, now: Date): Promise<boolean>
  /**
   * Crea el compromiso. Un compromiso vencido del mismo heroe deja de bloquear y
   * se marca `RELEASED` de forma perezosa, para que su caducidad sea real y no
   * solo decorativa.
   */
  commit(input: BattleHeroCommitmentInput, now: Date): Promise<BattleHeroCommitment>
  /** Idempotente: liberar lo ya liberado, o lo que no existe, no es un error. */
  release(operationId: string): Promise<void>
}

export const BATTLE_HERO_COMMITMENTS = Symbol('BattleHeroCommitmentPort')

/** El mismo `operationId` llego con otro contenido. No se sobrescribe. */
export class BattleCommitmentConflictError extends Error {
  constructor() {
    super('El operationId ya se uso con otra solicitud.')
    this.name = 'BattleCommitmentConflictError'
  }
}

/** El heroe ya esta en otra batalla activa. */
export class BattleHeroCommittedError extends Error {
  constructor() {
    super('El heroe ya participa en una batalla activa.')
    this.name = 'BattleHeroCommittedError'
  }
}

export const sameBattleCommitment = (
  a: BattleHeroCommitmentInput,
  b: BattleHeroCommitmentInput,
): boolean =>
  a.operationId === b.operationId &&
  a.playerId === b.playerId &&
  a.heroId === b.heroId &&
  a.reference === b.reference &&
  a.expiresAt.getTime() === b.expiresAt.getTime()
