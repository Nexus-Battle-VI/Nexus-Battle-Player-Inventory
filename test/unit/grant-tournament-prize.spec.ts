import {
  GrantTournamentPrize,
  normalizeTournamentPrize,
} from '../../src/application/use-cases/GrantTournamentPrize'
import {
  TournamentPrizeError,
  type TournamentPrizePort,
} from '../../src/application/ports/TournamentPrizePort'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { Inventory } from '../../src/domain/entities/Inventory'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import { QA_HERO_ID, qaCommand, qaEpic, qaHero } from '../fixtures/tournament-prize'

describe('HU-86 validacion del destino Inventory', () => {
  const fixture = async () => {
    const inventory = new InMemoryInventoryRepository()
    await inventory.save(
      Inventory.restore({
        ownerId: PlayerId.create('qa-hu86-player'),
        capacity: 200,
        slots: [{ itemId: QA_HERO_ID, quantity: 1 }],
      }),
    )
    const port = {
      find: jest.fn().mockResolvedValue(null),
      grant: jest
        .fn()
        .mockImplementation((command) =>
          Promise.resolve({ ...command, status: 'DELIVERED', receiptId: 'qa-receipt' }),
        ),
    } satisfies TournamentPrizePort
    const catalog = new InMemoryCatalogReadClient([qaHero, qaEpic])
    return { inventory, port, catalog, useCase: new GrantTournamentPrize(port, inventory, catalog) }
  }
  it('acepta null explícito por ausencia y rechaza referencia vacía u omitida', async () => {
    const { useCase, port } = await fixture()
    const c = { ...qaCommand(), finalRoomId: null }
    expect(await useCase.execute(c)).toEqual({ ...c, status: 'DELIVERED', receiptId: 'qa-receipt' })
    expect(port.grant).toHaveBeenCalledWith(c, QA_HERO_ID)
    for (const finalRoomId of [undefined, '', ' '])
      expect(() => normalizeTournamentPrize({ ...c, finalRoomId })).toThrow(TournamentPrizeError)
    const missing = Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'finalRoomId'))
    expect(() => normalizeTournamentPrize(missing)).toThrow(TournamentPrizeError)
  })
  it('valida el producto y entrega una unidad sin equipar', async () => {
    const { useCase, port } = await fixture()
    expect(await useCase.execute(qaCommand())).toEqual({
      ...qaCommand(),
      status: 'DELIVERED',
      receiptId: 'qa-receipt',
    })
    expect(port.grant).toHaveBeenCalledWith(qaCommand(), QA_HERO_ID)
  })
  it.each(['actor', 'receiptId', 'purpose', 'status', 'authorization'])(
    'rechaza campo ajeno %s',
    async (field) => {
      const { useCase, port } = await fixture()
      await expect(
        useCase.execute({ ...qaCommand(), [field]: 'manipulado' }),
      ).rejects.toMatchObject({ code: 'SCHEMA_INVALID', status: 400 })
      expect(port.grant).not.toHaveBeenCalled()
    },
  )
  it.each([
    null,
    [],
    {},
    { ...qaCommand(), amount: '1' },
    { ...qaCommand(), kind: 'CREDITS' },
    { ...qaCommand(), playerId: ' jugador ' },
    { ...qaCommand(), heroId: '' },
    { ...qaCommand(), operationId: 'x'.repeat(513) },
    { ...qaCommand(), operationId: 'qa\u0000id' },
    { ...qaCommand(), amount: undefined },
  ])('rechaza forma invalida %#', (command) => {
    expect(() => normalizeTournamentPrize(command)).toThrow(TournamentPrizeError)
  })
  it('canoniza el orden de campos sin permitir propositos recibidos', () => {
    const command = qaCommand()
    expect(normalizeTournamentPrize(Object.fromEntries(Object.entries(command).reverse()))).toEqual(
      command,
    )
  })
  it.each(['otro-jugador', 'inexistente'])('rechaza heroe ajeno para %s', async (playerId) => {
    const { useCase, port } = await fixture()
    await expect(useCase.execute({ ...qaCommand(), playerId })).rejects.toMatchObject({
      code: 'PRIZE_INVALID',
      status: 422,
    })
    expect(port.grant).not.toHaveBeenCalled()
  })
  it('rechaza un heroe inexistente sin conceder la epica', async () => {
    const { useCase, port } = await fixture()
    await expect(
      useCase.execute({ ...qaCommand(), heroId: '86000000-0000-4000-8000-000000000099' }),
    ).rejects.toMatchObject({ code: 'PRIZE_INVALID', status: 422 })
    expect(port.grant).not.toHaveBeenCalled()
  })
  it.each(['missing', 'type', 'inactive', 'incompatible', 'attributes', 'alias'])(
    'rechaza epica %s',
    async (scenario) => {
      const { port, inventory } = await fixture()
      const epic = {
        ...qaEpic,
        ...(scenario === 'type' ? { type: 'ARMA' } : {}),
        ...(scenario === 'inactive' ? { lifecycleStatus: 'SUSPENDED' } : {}),
        ...(scenario === 'incompatible'
          ? {
              attributes: {
                schemaVersion: '1',
                values: {
                  kind: 'EPICA',
                  compatibleHeroSubtype: 'GUERRERO_TANQUE',
                  specificEffect: {},
                },
              },
            }
          : {}),
        ...(scenario === 'attributes' ? { attributes: {} } : {}),
      }
      const catalog = new InMemoryCatalogReadClient(
        scenario === 'missing' ? [qaHero] : [qaHero, epic],
      )
      const command = { ...qaCommand(), ...(scenario === 'alias' ? { productId: qaEpic.sku } : {}) }
      await expect(
        new GrantTournamentPrize(port, inventory, catalog).execute(command),
      ).rejects.toMatchObject({ code: 'PRIZE_INVALID', status: 422 })
      expect(port.grant).not.toHaveBeenCalled()
    },
  )
  it('indisponibilidad de Catalog conserva diagnostico 503 sin entrega', async () => {
    const { port, inventory } = await fixture()
    const catalog = {
      getByReference: () => Promise.reject(new CatalogUnavailableError('QA unavailable')),
      lookup: () => Promise.resolve([]),
    }
    await expect(
      new GrantTournamentPrize(port, inventory, catalog).execute(qaCommand()),
    ).rejects.toMatchObject({ code: 'PRIZE_DEPENDENCY_UNAVAILABLE', status: 503 })
    expect(port.grant).not.toHaveBeenCalled()
  })
  it('replay confirmado no depende de volver a disponer de heroe/catalogo', async () => {
    const { port, inventory } = await fixture()
    const receipt = { ...qaCommand(), status: 'DELIVERED' as const, receiptId: 'qa-receipt' }
    port.find = jest.fn().mockResolvedValue(receipt)
    const catalog = {
      getByReference: jest.fn().mockRejectedValue(new Error('offline')),
      lookup: () => Promise.resolve([]),
    }
    expect(await new GrantTournamentPrize(port, inventory, catalog).execute(qaCommand())).toEqual(
      receipt,
    )
    expect(catalog.getByReference).not.toHaveBeenCalled()
    expect(port.grant).not.toHaveBeenCalled()
  })
})
