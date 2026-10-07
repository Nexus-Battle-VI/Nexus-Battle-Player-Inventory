import { PlayerId } from '../../domain/value-objects/identifiers'
import type { BattleDropSnapshot, BattleDropSnapshotPort } from '../ports/BattleDropSnapshotPort'
import { BattleDropSnapshotRejectedError } from '../ports/BattleDropSnapshotPort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import { CatalogUnavailableError } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'

export interface CaptureBattleDropSnapshotCommand {
  readonly battleId: string
  readonly playerId: string
  readonly heroId: string
  readonly loadoutVersion: number
}

/** Proyecta el loadout vigente y la tasa canónica; la identidad se reserva en Mongo. */
export class CaptureBattleDropSnapshot {
  constructor(
    private readonly loadouts: HeroLoadoutRepositoryPort,
    private readonly catalog: CatalogReadPort,
    private readonly snapshots: BattleDropSnapshotPort,
  ) {}

  async execute(command: CaptureBattleDropSnapshotCommand): Promise<BattleDropSnapshot> {
    const loadout = await this.loadouts.findByHero(
      PlayerId.create(command.playerId),
      command.heroId,
    )
    if ((loadout?.version ?? 0) !== command.loadoutVersion) {
      throw new BattleDropSnapshotRejectedError('LOADOUT_CHANGED')
    }
    const entries = loadout?.toSnapshot().entries ?? []
    const products = await this.catalog.lookup({ references: entries.map((entry) => entry.itemId) })
    const equipment = entries.map((entry) => {
      const product = products.find(
        (candidate) =>
          candidate.productId === entry.productId &&
          (candidate.sku === entry.itemId || candidate.productId === entry.itemId),
      )
      if (product === undefined) {
        throw new CatalogUnavailableError(`producto equipado ${entry.productId} no resuelto`)
      }
      const envelope = product.attributes
      const values =
        typeof envelope === 'object' && envelope !== null && 'values' in envelope
          ? envelope.values
          : null
      const rate =
        typeof values === 'object' && values !== null && 'dropChanceBasisPoints' in values
          ? values.dropChanceBasisPoints
          : undefined
      if (
        !['ARMA', 'ARMADURA', 'ITEM'].includes(product.type) ||
        typeof rate !== 'number' ||
        !Number.isInteger(rate) ||
        rate < 0 ||
        rate > 10000
      ) {
        throw new BattleDropRateUnavailableError(entry.productId)
      }
      return {
        slot: entry.slot,
        itemId: entry.itemId,
        productId: entry.productId,
        dropChanceBasisPoints: rate,
      }
    })
    return this.snapshots.capture({ ...command, equipment })
  }
}

export class BattleDropRateUnavailableError extends Error {
  constructor(readonly productId: string) {
    super(`El producto equipado ${productId} no tiene tasa de caída canónica.`)
    this.name = 'BattleDropRateUnavailableError'
  }
}
