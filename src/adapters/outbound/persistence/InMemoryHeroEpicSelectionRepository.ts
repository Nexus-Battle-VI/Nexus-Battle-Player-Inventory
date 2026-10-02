import {
  HeroEpicSelection,
  type HeroEpicSelectionSnapshot,
} from '../../../domain/entities/HeroEpicSelection'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroEpicSelectionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroEpicSelectionRepositoryPort } from '../../../application/ports/HeroEpicSelectionRepositoryPort'

/**
 * Repositorio en memoria de la epica equipada (HU-31).
 *
 * Almacena instantaneas, no el agregado vivo, mismo criterio que
 * `InMemoryHeroLoadoutRepository`: una mutacion sin guardar no se filtra al
 * almacen, y el bloqueo optimista se reproduce comparando version esperada
 * con la almacenada.
 */
export class InMemoryHeroEpicSelectionRepository implements HeroEpicSelectionRepositoryPort {
  private readonly byKey = new Map<string, HeroEpicSelectionSnapshot>()

  private static key(ownerId: string, heroId: string): string {
    return `${ownerId}::${heroId}`
  }

  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroEpicSelection | null> {
    const snapshot = this.byKey.get(InMemoryHeroEpicSelectionRepository.key(ownerId.value, heroId))

    return Promise.resolve(snapshot === undefined ? null : HeroEpicSelection.restore(snapshot))
  }

  save(selection: HeroEpicSelection, expectedVersion: number): Promise<HeroEpicSelection> {
    const key = InMemoryHeroEpicSelectionRepository.key(selection.ownerId, selection.heroId)
    const current = this.byKey.get(key)
    const storedVersion = current?.version ?? 0

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new HeroEpicSelectionConflictError(selection.heroId))
    }

    const snapshot = selection.toSnapshot()
    const nextVersion = expectedVersion + 1
    const persisted: HeroEpicSelectionSnapshot = { ...snapshot, version: nextVersion }

    this.byKey.set(key, persisted)
    selection.pullEvents()

    return Promise.resolve(HeroEpicSelection.restore(persisted))
  }
}
