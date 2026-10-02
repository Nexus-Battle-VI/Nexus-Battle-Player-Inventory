/** La decisión de drop y el killer vienen de Combat, nunca de Web. */
export interface BattleDropTransferCommand {
  readonly operationId: string
  readonly battleId: string
  readonly defeatEventSeq: number
  readonly sourcePlayerId: string
  readonly targetPlayerId: string
  readonly productInstanceId: string
}

export interface BattleDropTransferResult extends BattleDropTransferCommand {
  readonly productId: string
  readonly itemId: string
  readonly creditedAt: string
  readonly applied: true
}

export class BattleDropTransferConflictError extends Error {
  constructor() {
    super('El operationId ya se usó con otra transferencia.')
    this.name = 'BattleDropTransferConflictError'
  }
}

export class BattleDropTransferRejectedError extends Error {
  constructor(readonly code: 'INSTANCE_NOT_OWNED' | 'TARGET_CAPACITY') {
    super(
      code === 'TARGET_CAPACITY'
        ? 'El inventario de destino está lleno.'
        : 'La instancia no pertenece al jugador origen.',
    )
    this.name = 'BattleDropTransferRejectedError'
  }
}

export interface BattleDropTransferPort {
  transfer(command: BattleDropTransferCommand): Promise<BattleDropTransferResult>
}

export const BATTLE_DROP_TRANSFERS = Symbol('BattleDropTransfers')
