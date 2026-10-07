import type {
  BattleDropTransferCommand,
  BattleDropTransferPort,
  BattleDropTransferResult,
} from '../ports/BattleDropTransferPort'
import { DomainError } from '../../domain/errors/DomainError'

/** Valida la identidad server-side antes de tocar la persistencia. */
export class TransferBattleDrop {
  constructor(private readonly transfers: BattleDropTransferPort) {}

  execute(command: BattleDropTransferCommand): Promise<BattleDropTransferResult> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        command.operationId,
      )
    ) {
      throw new DomainError('operationId debe ser UUID.')
    }
    for (const [name, value] of Object.entries({
      battleId: command.battleId,
      sourcePlayerId: command.sourcePlayerId,
      targetPlayerId: command.targetPlayerId,
      productInstanceId: command.productInstanceId,
    })) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new DomainError(`${name} es obligatorio.`)
      }
    }
    if (command.sourcePlayerId === command.targetPlayerId) {
      throw new DomainError('El origen y destino deben ser jugadores distintos.')
    }
    if (!Number.isSafeInteger(command.defeatEventSeq) || command.defeatEventSeq < 1) {
      throw new DomainError('defeatEventSeq debe ser un entero positivo.')
    }
    return this.transfers.transfer(command)
  }
}
