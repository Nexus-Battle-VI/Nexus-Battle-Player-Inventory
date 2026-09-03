import { DomainError } from '../errors/DomainError'

export interface HeroSelectionSnapshot {
  readonly ownerId: string
  /** Identidad canonica (UUID) del producto HEROE elegido. */
  readonly heroId: string
  readonly selectedAt: Date
  readonly version: number
}

/**
 * Heroe que un jugador tiene preparado (HU-07, RF-07).
 *
 * ES UNA SELECCION, NO UNA COPIA DEL HEROE. Guarda a quien pertenece, que
 * producto se eligio y cuando. Ni las estadisticas ni el equipamiento viven
 * aqui: las primeras son de Catalog y el segundo es de `HeroLoadout` (HU-28).
 * Duplicarlos daria dos versiones de la misma verdad, que es justo el riesgo
 * que la TASK HU-07.2 enumera.
 *
 * ES UNA POR JUGADOR. El agregado se identifica por el jugador, no por el par
 * (jugador, heroe): elegir otro heroe SUSTITUYE la seleccion, no crea una
 * segunda. Por eso `heroId` cambia dentro del mismo agregado y `version`
 * sostiene el bloqueo optimista: dos peticiones simultaneas de seleccion no
 * pueden dejar dos heroes preparados.
 *
 * EL EQUIPAMIENTO NO SE BORRA AL CAMBIAR DE HEROE. Cada `HeroLoadout` sigue
 * atado a su propio heroe; volver a un heroe anterior recupera su configuracion
 * intacta. Perderla al cambiar seria destruir trabajo del jugador sin que
 * ninguna regla de HU-07 lo pida.
 */
export class HeroSelection {
  readonly ownerId: string
  readonly heroId: string
  readonly selectedAt: Date
  private readonly _version: number

  private constructor(ownerId: string, heroId: string, selectedAt: Date, version: number) {
    this.ownerId = ownerId
    this.heroId = heroId
    this.selectedAt = selectedAt
    this._version = version
  }

  static create(ownerId: string, heroId: string, at: Date): HeroSelection {
    return HeroSelection.restore({ ownerId, heroId, selectedAt: at, version: 0 })
  }

  static restore(snapshot: HeroSelectionSnapshot): HeroSelection {
    if (snapshot.ownerId.trim().length === 0) {
      throw new DomainError('Una seleccion de heroe necesita un jugador.')
    }
    if (snapshot.heroId.trim().length === 0) {
      throw new DomainError('Una seleccion de heroe necesita un heroe.')
    }
    if (!Number.isInteger(snapshot.version) || snapshot.version < 0) {
      throw new DomainError('La version de la seleccion debe ser un entero no negativo.')
    }
    if (Number.isNaN(snapshot.selectedAt.getTime())) {
      throw new DomainError('La fecha de seleccion no es valida.')
    }

    return new HeroSelection(
      snapshot.ownerId.trim(),
      snapshot.heroId.trim(),
      snapshot.selectedAt,
      snapshot.version,
    )
  }

  get version(): number {
    return this._version
  }

  isFor(heroId: string): boolean {
    return this.heroId === heroId.trim()
  }

  /**
   * Sustituye el heroe preparado. Devuelve un agregado nuevo con la MISMA
   * version: la version que se incrementa es la almacenada, y eso lo decide el
   * repositorio al guardar con `expectedVersion`.
   */
  selectAnother(heroId: string, at: Date): HeroSelection {
    return HeroSelection.restore({
      ownerId: this.ownerId,
      heroId,
      selectedAt: at,
      version: this._version,
    })
  }

  toSnapshot(): HeroSelectionSnapshot {
    return {
      ownerId: this.ownerId,
      heroId: this.heroId,
      selectedAt: this.selectedAt,
      version: this._version,
    }
  }
}
