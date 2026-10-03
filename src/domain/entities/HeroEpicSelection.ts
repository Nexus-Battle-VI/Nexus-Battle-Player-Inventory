import { DomainError } from '../errors/DomainError'
import type { DomainEvent } from '../events/DomainEvent'
import { heroEpicEquipped } from '../events/HeroEpicSelectionEvents'
import { ItemId } from '../value-objects/identifiers'

/**
 * Seleccion persistida de la habilidad epica equipada de UN heroe (HU-31,
 * contrato `hu-31-equipped-epic-v1`).
 *
 * Agregado HERMANO de `HeroLoadout`, deliberadamente separado: HU-28 excluye
 * `EPICA` de `EquipmentCategory` (no es ARMA/ARMADURA/ITEM), y esta seleccion
 * no tiene ranuras ni capacidad 2/6/2 -- es un unico valor, 0 o 1 epica por
 * heroe (`P-HU31-EPIC-CARDINALITY`, sin fuente formal que fije otra cosa).
 */
export interface HeroEpicSelectionSnapshot {
  readonly ownerId: string
  readonly heroId: string
  readonly version: number
  readonly epicItemId: string | null
  readonly epicProductId: string | null
}

/**
 * Raiz de agregado de la epica equipada de un heroe (HU-31).
 *
 * No hay `unequip()`: equipar reemplaza directamente la seleccion anterior
 * (a diferencia de `HeroLoadout.equip()`, que rechaza una ranura ya ocupada
 * por OTRO producto). La diferencia es intencional: `HeroLoadout` tiene varias
 * ranuras discretas donde dos productos distintos podrian competir por la
 * misma; esta seleccion tiene un unico valor, asi que "equipar la epica B" ya
 * expresa sin ambiguedad "deja de estar equipada la epica A". Ningun
 * escenario formal exige desequipar sin reemplazar (contrato §3).
 */
export class HeroEpicSelection {
  readonly ownerId: string
  readonly heroId: string
  private readonly _version: number
  private _epicItemId: string | null
  private _epicProductId: string | null
  private readonly events: DomainEvent[] = []

  private constructor(
    ownerId: string,
    heroId: string,
    version: number,
    epicItemId: string | null,
    epicProductId: string | null,
  ) {
    this.ownerId = ownerId
    this.heroId = heroId
    this._version = version
    this._epicItemId = epicItemId
    this._epicProductId = epicProductId
  }

  static createEmpty(ownerId: string, heroId: string): HeroEpicSelection {
    return new HeroEpicSelection(ownerId, heroId, 0, null, null)
  }

  /** Reconstituye una seleccion persistida. No emite eventos. */
  static restore(snapshot: HeroEpicSelectionSnapshot): HeroEpicSelection {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 0) {
      throw new DomainError(
        'La version restaurada de la epica equipada debe ser un entero no negativo.',
      )
    }
    if ((snapshot.epicItemId === null) !== (snapshot.epicProductId === null)) {
      throw new DomainError(
        'La seleccion restaurada de epica debe declarar ambas referencias o ninguna.',
      )
    }

    return new HeroEpicSelection(
      snapshot.ownerId,
      snapshot.heroId,
      snapshot.version,
      snapshot.epicItemId === null ? null : ItemId.create(snapshot.epicItemId).value,
      snapshot.epicProductId,
    )
  }

  get version(): number {
    return this._version
  }

  get epicItemId(): string | null {
    return this._epicItemId
  }

  get epicProductId(): string | null {
    return this._epicProductId
  }

  isEmpty(): boolean {
    return this._epicItemId === null
  }

  pullEvents(): readonly DomainEvent[] {
    return this.events.splice(0, this.events.length)
  }

  /**
   * Equipa (o reemplaza) la epica del heroe.
   *
   * Precondiciones ya comprobadas por la capa de aplicacion: el heroe y la
   * epica pertenecen al jugador, Catalog resuelve el producto con
   * `type = EPICA`, y no hay compromiso de batalla activo (HU-29, contrato
   * §9). El agregado solo aplica la forma del valor, no reabre esas
   * comprobaciones externas.
   */
  equip(params: {
    readonly epicItemId: string
    readonly epicProductId: string
    readonly occurredAt: Date
  }): void {
    const epicItemId = ItemId.create(params.epicItemId).value

    this._epicItemId = epicItemId
    this._epicProductId = params.epicProductId
    this.events.push(
      heroEpicEquipped({
        aggregateId: `${this.ownerId}:${this.heroId}`,
        heroId: this.heroId,
        epicItemId,
        epicProductId: params.epicProductId,
        occurredAt: params.occurredAt,
      }),
    )
  }

  toSnapshot(): HeroEpicSelectionSnapshot {
    return {
      ownerId: this.ownerId,
      heroId: this.heroId,
      version: this._version,
      epicItemId: this._epicItemId,
      epicProductId: this._epicProductId,
    }
  }
}
