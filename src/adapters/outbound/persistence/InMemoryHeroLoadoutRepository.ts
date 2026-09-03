import { HeroLoadout, type HeroLoadoutSnapshot } from '../../../domain/entities/HeroLoadout'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroLoadoutConflictError } from '../../../application/errors/ApplicationError'
import type { HeroLoadoutRepositoryPort } from '../../../application/ports/HeroLoadoutRepositoryPort'

/**
 * Repositorio en memoria del loadout de heroe.
 *
 * Almacena instantaneas, no el agregado vivo: una mutacion sin guardar no se
 * filtra al almacen. Reproduce el bloqueo optimista de MongoDB comparando la
 * version esperada con la almacenada, para que las pruebas de los casos de uso
 * ejerciten el conflicto sin contenedor.
 */
export class InMemoryHeroLoadoutRepository implements HeroLoadoutRepositoryPort {
  private readonly byKey = new Map<string, HeroLoadoutSnapshot>()

  private static key(ownerId: string, heroId: string): string {
    return `${ownerId}::${heroId}`
  }

  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroLoadout | null> {
    const snapshot = this.byKey.get(InMemoryHeroLoadoutRepository.key(ownerId.value, heroId))

    return Promise.resolve(snapshot === undefined ? null : HeroLoadout.restore(snapshot))
  }

  save(loadout: HeroLoadout, expectedVersion: number): Promise<HeroLoadout> {
    const key = InMemoryHeroLoadoutRepository.key(loadout.ownerId, loadout.heroId)
    const current = this.byKey.get(key)
    const storedVersion = current?.version ?? 0

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new HeroLoadoutConflictError(loadout.heroId))
    }

    const snapshot = loadout.toSnapshot()
    const nextVersion = expectedVersion + 1
    const persisted: HeroLoadoutSnapshot = { ...snapshot, version: nextVersion }

    this.byKey.set(key, persisted)
    // Se drenan los eventos: el almacen es el limite de la transaccion logica.
    loadout.pullEvents()

    return Promise.resolve(HeroLoadout.restore(persisted))
  }
}
