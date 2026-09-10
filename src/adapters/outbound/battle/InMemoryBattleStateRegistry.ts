import type { BattleStatePort } from '../../../application/ports/BattleStatePort'
import type { PlayerId } from '../../../domain/value-objects/identifiers'

/**
 * Registro reemplazable para desarrollo y pruebas mientras HU-14 publica el
 * contrato productivo del contexto de combate.
 *
 * Los metodos de inicio/fin representan la frontera de integracion, no un
 * motor de batalla. No hay endpoint nuevo ni se inventa el ciclo de vida.
 */
export class InMemoryBattleStateRegistry implements BattleStatePort {
  private readonly activeHeroes = new Set<string>()

  private static key(ownerId: PlayerId, heroId: string): string {
    return `${ownerId.value}::${heroId}`
  }

  isHeroInActiveBattle(ownerId: PlayerId, heroId: string): Promise<boolean> {
    return Promise.resolve(this.activeHeroes.has(InMemoryBattleStateRegistry.key(ownerId, heroId)))
  }

  markBattleStarted(ownerId: PlayerId, heroId: string): void {
    this.activeHeroes.add(InMemoryBattleStateRegistry.key(ownerId, heroId))
  }

  markBattleFinished(ownerId: PlayerId, heroId: string): void {
    this.activeHeroes.delete(InMemoryBattleStateRegistry.key(ownerId, heroId))
  }
}
