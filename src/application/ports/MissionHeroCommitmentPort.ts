/** Reservas de heroes para Missions. La clave estable es el operationId del llamador. */
export interface MissionHeroCommitmentInput {
  readonly operationId: string
  readonly playerId: string
  readonly heroId: string
  readonly reference: string
  readonly expiresAt: Date
  readonly completeLoadout: boolean
}

export interface MissionHeroCommitment extends MissionHeroCommitmentInput {
  readonly commitmentId: string
  readonly status: 'ACTIVE' | 'RELEASED'
}

export interface MissionHeroCommitmentPort {
  findByOperation(operationId: string): Promise<MissionHeroCommitment | null>
  commit(
    input: MissionHeroCommitmentInput,
    expectedLoadoutVersion: number,
  ): Promise<MissionHeroCommitment>
  release(operationId: string): Promise<void>
}

export const MISSION_HERO_COMMITMENTS = Symbol('MissionHeroCommitmentPort')

export class MissionCommitmentConflictError extends Error {
  constructor() {
    super('El operationId ya se uso con otra solicitud o el compromiso ya termino.')
    this.name = 'MissionCommitmentConflictError'
  }
}

export class HeroCommittedError extends Error {
  constructor(readonly purpose: 'MISSION' = 'MISSION') {
    super('El heroe ya tiene un compromiso vigente.')
    this.name = 'HeroCommittedError'
  }
}

export class MissionCommitmentConcurrentError extends Error {
  constructor() {
    super('El equipamiento cambio durante la reserva; reintente la misma operacion.')
    this.name = 'MissionCommitmentConcurrentError'
  }
}

export const sameMissionCommitment = (
  a: MissionHeroCommitmentInput,
  b: MissionHeroCommitmentInput,
): boolean =>
  a.operationId === b.operationId &&
  a.playerId === b.playerId &&
  a.heroId === b.heroId &&
  a.reference === b.reference &&
  a.expiresAt.getTime() === b.expiresAt.getTime() &&
  a.completeLoadout === b.completeLoadout
