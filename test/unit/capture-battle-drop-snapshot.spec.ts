import {
  CaptureBattleDropSnapshot,
  BattleDropRateUnavailableError,
} from '../../src/application/use-cases/CaptureBattleDropSnapshot'
import {
  BattleDropSnapshotRejectedError,
  type BattleDropSnapshot,
} from '../../src/application/ports/BattleDropSnapshotPort'
import {
  CatalogUnavailableError,
  type CatalogProductView,
} from '../../src/application/ports/CatalogReadPort'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'

const PLAYER_ID = 'jugador-1'
const HERO_ID = 'heroe-1'
const BATTLE_ID = 'battle-1'
const PRODUCT_ID = 'producto-1'
const ITEM_ID = 'espada'

const arma = (dropChanceBasisPoints: unknown): CatalogProductView => ({
  productId: PRODUCT_ID,
  sku: ITEM_ID,
  name: 'Espada',
  imageUrl: '',
  description: '',
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1', values: { kind: 'ARMA', dropChanceBasisPoints } },
})

const loadoutCon = (version: number) =>
  HeroLoadout.restore({
    ownerId: PLAYER_ID,
    heroId: HERO_ID,
    version,
    entries: [{ slot: 'WEAPON_1', itemId: ITEM_ID, productId: PRODUCT_ID }],
  })

describe('CaptureBattleDropSnapshot (HU-30)', () => {
  const build = (options: {
    readonly loadout?: HeroLoadout | null
    readonly products?: readonly CatalogProductView[]
  }) => {
    const captured: unknown[] = []
    const loadouts = {
      findByHero: jest.fn().mockResolvedValue(options.loadout ?? null),
      findByOwner: jest.fn(),
      save: jest.fn(),
    }
    const catalog = {
      lookup: jest.fn().mockResolvedValue(options.products ?? []),
      getByReference: jest.fn(),
    }
    const snapshots = {
      capture: jest.fn((command: unknown) => {
        captured.push(command)
        return Promise.resolve(command as BattleDropSnapshot)
      }),
      find: jest.fn(),
      closeBattle: jest.fn(),
    }
    return {
      captured,
      loadouts,
      catalog,
      snapshots,
      useCase: new CaptureBattleDropSnapshot(loadouts, catalog, snapshots),
    }
  }

  it('sin loadout previo, loadoutVersion distinto de 0 es LOADOUT_CHANGED', async () => {
    const { useCase } = build({ loadout: null })

    await expect(
      useCase.execute({
        battleId: BATTLE_ID,
        playerId: PLAYER_ID,
        heroId: HERO_ID,
        loadoutVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'LOADOUT_CHANGED' })
  })

  it('el loadout cambio desde que se comprometio la batalla: LOADOUT_CHANGED', async () => {
    const { useCase } = build({ loadout: loadoutCon(3) })

    await expect(
      useCase.execute({
        battleId: BATTLE_ID,
        playerId: PLAYER_ID,
        heroId: HERO_ID,
        loadoutVersion: 2,
      }),
    ).rejects.toBeInstanceOf(BattleDropSnapshotRejectedError)
  })

  it('sin loadout y loadoutVersion 0: congela una instantanea vacia', async () => {
    const { useCase, captured } = build({ loadout: null })

    const snapshot = await useCase.execute({
      battleId: BATTLE_ID,
      playerId: PLAYER_ID,
      heroId: HERO_ID,
      loadoutVersion: 0,
    })

    expect(snapshot).toMatchObject({ battleId: BATTLE_ID, equipment: [] })
    expect(captured).toHaveLength(1)
  })

  it('producto equipado que Catalog no resuelve: CatalogUnavailableError', async () => {
    const { useCase } = build({ loadout: loadoutCon(0), products: [] })

    await expect(
      useCase.execute({
        battleId: BATTLE_ID,
        playerId: PLAYER_ID,
        heroId: HERO_ID,
        loadoutVersion: 0,
      }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError)
  })

  it('producto que no es ARMA/ARMADURA/ITEM: tasa no disponible', async () => {
    const { useCase } = build({
      loadout: loadoutCon(0),
      products: [{ ...arma(500), type: 'HEROE' }],
    })

    await expect(
      useCase.execute({
        battleId: BATTLE_ID,
        playerId: PLAYER_ID,
        heroId: HERO_ID,
        loadoutVersion: 0,
      }),
    ).rejects.toBeInstanceOf(BattleDropRateUnavailableError)
  })

  it.each([
    ['ausente', undefined],
    ['no numerica', 'alta'],
    ['no entera', 12.5],
    ['negativa', -1],
    ['fuera de rango', 10_001],
  ])(
    'tasa %s: BattleDropRateUnavailableError, nunca inventa un valor',
    async (_label, dropChanceBasisPoints) => {
      const { useCase } = build({ loadout: loadoutCon(0), products: [arma(dropChanceBasisPoints)] })

      await expect(
        useCase.execute({
          battleId: BATTLE_ID,
          playerId: PLAYER_ID,
          heroId: HERO_ID,
          loadoutVersion: 0,
        }),
      ).rejects.toBeInstanceOf(BattleDropRateUnavailableError)
    },
  )

  it('producto resuelto por sku con tasa valida: congela la unidad con esa tasa exacta', async () => {
    const { useCase, snapshots } = build({ loadout: loadoutCon(0), products: [arma(500)] })

    const snapshot = await useCase.execute({
      battleId: BATTLE_ID,
      playerId: PLAYER_ID,
      heroId: HERO_ID,
      loadoutVersion: 0,
    })

    expect(snapshot.equipment).toEqual([
      { slot: 'WEAPON_1', itemId: ITEM_ID, productId: PRODUCT_ID, dropChanceBasisPoints: 500 },
    ])
    expect(snapshots.capture).toHaveBeenCalledTimes(1)
  })

  it('attributes sin forma de sobre valido: tasa no disponible, no lanza un error distinto', async () => {
    const { useCase } = build({
      loadout: loadoutCon(0),
      products: [{ ...arma(500), attributes: 'no-es-un-objeto' }],
    })

    await expect(
      useCase.execute({
        battleId: BATTLE_ID,
        playerId: PLAYER_ID,
        heroId: HERO_ID,
        loadoutVersion: 0,
      }),
    ).rejects.toBeInstanceOf(BattleDropRateUnavailableError)
  })
})
