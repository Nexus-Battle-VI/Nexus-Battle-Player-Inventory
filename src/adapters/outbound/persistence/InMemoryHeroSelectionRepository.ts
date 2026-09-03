import { HeroSelection, type HeroSelectionSnapshot } from '../../../domain/entities/HeroSelection'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroSelectionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroSelectionRepositoryPort } from '../../../application/ports/HeroSelectionRepositoryPort'

/**
 * Repositorio en memoria de la seleccion de heroe (HU-07).
 *
 * Almacena instantaneas, no el agregado vivo, y reproduce el bloqueo optimista
 * de MongoDB comparando la version esperada con la almacenada: las pruebas de
 * los casos de uso ejercitan el conflicto sin contenedor.
 */
export class InMemoryHeroSelectionRepository implements HeroSelectionRepositoryPort {
  private readonly byOwner = new Map<string, HeroSelectionSnapshot>()

  findByOwner(ownerId: PlayerId): Promise<HeroSelection | null> {
    const snapshot = this.byOwner.get(ownerId.value)

    return Promise.resolve(snapshot === undefined ? null : HeroSelection.restore(snapshot))
  }

  save(selection: HeroSelection, expectedVersion: number): Promise<HeroSelection> {
    const stored = this.byOwner.get(selection.ownerId)
    const storedVersion = stored?.version ?? 0

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new HeroSelectionConflictError(selection.ownerId))
    }

    const persisted: HeroSelectionSnapshot = {
      ...selection.toSnapshot(),
      version: expectedVersion + 1,
    }

    this.byOwner.set(selection.ownerId, persisted)

    return Promise.resolve(HeroSelection.restore(persisted))
  }
}
