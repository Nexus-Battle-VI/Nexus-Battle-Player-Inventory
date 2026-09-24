import { randomUUID } from 'node:crypto'

import { BattleCommitmentStateAdapter } from '../../src/adapters/outbound/battle/BattleCommitmentStateAdapter'
import { InMemoryBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryBattleHeroCommitmentRepository'
import type { BattleStatePort } from '../../src/application/ports/BattleStatePort'
import type { ClockPort } from '../../src/application/ports/ClockPort'

/**
 * Arranque y fin de batalla para las pruebas (HU-29).
 *
 * NO HAY UN DOBLE DE «ESTADO DE BATALLA» APARTE. Empezar una batalla es
 * **comprometer** al heroe y terminarla es **liberarlo**, que es exactamente lo
 * que hace Combat por la ruta interna. Un atajo que marcara el estado sin pasar
 * por el compromiso probaria un camino que en produccion no existe, y el fallo
 * —que el guard no ve la batalla— solo apareceria fuera de las pruebas.
 */
export interface BattleStateKit {
  readonly state: BattleStatePort
  readonly commitments: InMemoryBattleHeroCommitmentRepository
  /** Compromete al heroe: a partir de aqui el loadout esta bloqueado. */
  startBattle: (playerId: string, heroId: string) => Promise<void>
  /** Lo libera: el flujo normal de HU-28 vuelve. */
  finishBattle: (playerId: string, heroId: string) => Promise<string>
}

export const battleStateKit = (clock: ClockPort): BattleStateKit => {
  const commitments = new InMemoryBattleHeroCommitmentRepository()
  const operations = new Map<string, string>()

  return {
    commitments,
    state: new BattleCommitmentStateAdapter(commitments, clock),
    startBattle: async (playerId, heroId) => {
      const operationId = randomUUID()

      await commitments.commit(
        {
          operationId,
          playerId,
          heroId,
          reference: `room_${operationId}`,
          expiresAt: new Date(clock.now().getTime() + 3_600_000),
        },
        clock.now(),
      )
      operations.set(`${playerId}::${heroId}`, operationId)
    },
    finishBattle: async (playerId, heroId) => {
      const key = `${playerId}::${heroId}`
      const operationId = operations.get(key)

      if (operationId === undefined) {
        throw new Error(`No hay batalla comprometida para ${key}`)
      }

      await commitments.release(operationId)
      operations.delete(key)

      return operationId
    },
  }
}
