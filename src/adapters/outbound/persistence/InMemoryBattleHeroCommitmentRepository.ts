import type {
  BattleHeroCommitment,
  BattleHeroCommitmentInput,
  BattleHeroCommitmentPort,
} from '../../../application/ports/BattleHeroCommitmentPort'
import {
  BattleCommitmentConflictError,
  BattleHeroCommittedError,
  sameBattleCommitment,
} from '../../../application/ports/BattleHeroCommitmentPort'

const key = (playerId: string, heroId: string): string => `${playerId}::${heroId}`

/**
 * Doble en memoria del compromiso de batalla, para desarrollo y pruebas.
 *
 * Respeta las DOS invariantes del adaptador real, porque si no la prueba diria
 * que el sistema funciona donde no lo hace: la clave es el `operationId`, y un
 * heroe no puede tener dos compromisos activos a la vez.
 */
export class InMemoryBattleHeroCommitmentRepository implements BattleHeroCommitmentPort {
  private readonly byOperation = new Map<string, BattleHeroCommitment>()
  private readonly activeByHero = new Map<string, string>()

  findByOperation(operationId: string): Promise<BattleHeroCommitment | null> {
    return Promise.resolve(this.byOperation.get(operationId) ?? null)
  }

  hasActiveForHero(playerId: string, heroId: string, now: Date): Promise<boolean> {
    const operationId = this.activeByHero.get(key(playerId, heroId))

    if (operationId === undefined) {
      return Promise.resolve(false)
    }

    const commitment = this.byOperation.get(operationId)

    return Promise.resolve(
      commitment?.status === 'ACTIVE' && commitment.expiresAt.getTime() > now.getTime(),
    )
  }

  /**
   * `async` a proposito: el puerto promete `Promise`, y un metodo que devuelve
   * una promesa pero LANZA de forma sincrona rompe a quien encadene `.catch()`
   * en lugar de `await`. El adaptador real es asincrono por naturaleza, asi que
   * el doble tiene que fallar igual: rechazando.
   */
  async commit(input: BattleHeroCommitmentInput, now: Date): Promise<BattleHeroCommitment> {
    const heroKey = key(input.playerId, input.heroId)
    const activeOperation = this.activeByHero.get(heroKey)
    const active = activeOperation === undefined ? null : this.byOperation.get(activeOperation)

    if (active !== null && active !== undefined && active.expiresAt.getTime() <= now.getTime()) {
      this.byOperation.set(active.operationId, { ...active, status: 'RELEASED' })
      this.activeByHero.delete(heroKey)
    }

    const previous = this.byOperation.get(input.operationId)

    if (previous !== undefined) {
      return this.replay(previous, input, now)
    }

    if (this.activeByHero.has(heroKey)) {
      throw new BattleHeroCommittedError()
    }

    const commitment: BattleHeroCommitment = {
      ...input,
      commitmentId: `cmt_${input.operationId}`,
      status: 'ACTIVE',
    }

    this.byOperation.set(input.operationId, commitment)
    this.activeByHero.set(heroKey, input.operationId)

    return commitment
  }

  async release(operationId: string): Promise<void> {
    const previous = this.byOperation.get(operationId)

    if (previous === undefined || previous.status === 'RELEASED') {
      return
    }

    this.byOperation.set(operationId, { ...previous, status: 'RELEASED' })

    const heroKey = key(previous.playerId, previous.heroId)

    if (this.activeByHero.get(heroKey) === operationId) {
      this.activeByHero.delete(heroKey)
    }
  }

  private replay(
    previous: BattleHeroCommitment,
    input: BattleHeroCommitmentInput,
    now: Date,
  ): BattleHeroCommitment {
    if (
      !sameBattleCommitment(previous, input) ||
      previous.status !== 'ACTIVE' ||
      previous.expiresAt.getTime() <= now.getTime()
    ) {
      throw new BattleCommitmentConflictError()
    }

    return previous
  }
}
