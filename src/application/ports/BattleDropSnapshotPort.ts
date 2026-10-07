export interface BattleDropEquipmentInput {
  readonly slot: string
  readonly itemId: string
  readonly productId: string
  readonly dropChanceBasisPoints: number
}

export interface BattleDropSnapshotCommand {
  readonly battleId: string
  readonly playerId: string
  readonly heroId: string
  readonly loadoutVersion: number
  readonly equipment: readonly BattleDropEquipmentInput[]
}

export interface BattleDropEquipment extends BattleDropEquipmentInput {
  readonly productInstanceId: string
}

export interface BattleDropSnapshot extends Omit<BattleDropSnapshotCommand, 'equipment'> {
  readonly equipment: readonly BattleDropEquipment[]
}

export class BattleDropSnapshotConflictError extends Error {
  constructor() {
    super('La instantánea de la batalla no coincide con la solicitud anterior.')
    this.name = 'BattleDropSnapshotConflictError'
  }
}

export class BattleDropSnapshotRejectedError extends Error {
  constructor(readonly code: 'NO_ACTIVE_COMMITMENT' | 'LOADOUT_CHANGED' | 'UNIT_UNAVAILABLE') {
    super(`La instantánea de drop no puede congelarse: ${code}.`)
    this.name = 'BattleDropSnapshotRejectedError'
  }
}

export interface BattleDropSnapshotPort {
  capture(command: BattleDropSnapshotCommand): Promise<BattleDropSnapshot>
  find(battleId: string, playerId: string): Promise<BattleDropSnapshot | null>
  /** Libera únicamente las unidades no transferidas tras liquidar todos los derechos. */
  closeBattle(battleId: string): Promise<void>
}

export const BATTLE_DROP_SNAPSHOTS = Symbol('BattleDropSnapshots')
