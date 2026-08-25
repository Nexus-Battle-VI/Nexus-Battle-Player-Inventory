import {
  AddItemToInventory,
  GetInventory,
  RemoveItemFromInventory,
} from '../../src/application/use-cases/InventoryUseCases'
import { InventoryNotFoundError } from '../../src/application/errors/ApplicationError'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { Inventory } from '../../src/domain/entities/Inventory'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'
import { DomainError } from '../../src/domain/errors/DomainError'
import { ConfigurationError, loadConfig } from '../../src/infrastructure/config/env'
import { createLogger } from '../../src/infrastructure/observability/logger'
import { buildLiveness, buildReadiness, buildVersion } from '../../src/infrastructure/health/health'
import { SystemClock } from '../../src/adapters/outbound/system/SystemClock'
import { UuidGenerator } from '../../src/adapters/outbound/system/UuidGenerator'

const FIXED_NOW = new Date('2026-08-21T10:00:00.000Z')

interface Harness {
  get: GetInventory
  add: AddItemToInventory
  remove: RemoveItemFromInventory
  inventories: InMemoryInventoryRepository
}

const buildHarness = (capacity = 30): Harness => {
  const inventories = new InMemoryInventoryRepository()
  const deps = {
    inventories,
    clock: { now: (): Date => FIXED_NOW },
    defaultCapacity: CapacityPolicy.of(capacity),
  }

  return {
    inventories,
    get: new GetInventory(inventories),
    add: new AddItemToInventory(deps),
    remove: new RemoveItemFromInventory(deps),
  }
}

describe('AddItemToInventory', () => {
  it('crea el inventario al primer alta de un jugador sin inventario', async () => {
    const harness = buildHarness(10)

    const result = await harness.add.execute({
      ownerId: 'player-42',
      itemId: 'espada',
      quantity: 1,
    })

    expect(result).toEqual({
      ownerId: 'player-42',
      capacity: 10,
      usedSlots: 1,
      freeSlots: 9,
      totalUnits: 1,
      slots: [{ itemId: 'espada', quantity: 1 }],
    })
    expect(harness.inventories.size).toBe(1)
  })

  it('persiste el resultado y lo relee del almacen', async () => {
    const harness = buildHarness()
    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 3 })

    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 4 })

    // Se relee del repositorio para confirmar que el cambio quedo persistido y
    // no solo aplicado sobre una instancia en memoria.
    const stored = await harness.get.execute('player-42')

    expect(stored.slots).toEqual([{ itemId: 'pocion', quantity: 7 }])
    expect(stored.usedSlots).toBe(1)
  })

  it('normaliza el identificador del objeto', async () => {
    const harness = buildHarness()

    const result = await harness.add.execute({
      ownerId: 'player-42',
      itemId: '  Espada-De-Hierro ',
      quantity: 1,
    })

    expect(result.slots).toEqual([{ itemId: 'espada-de-hierro', quantity: 1 }])
  })

  it('propaga el limite de capacidad como error de dominio', async () => {
    const harness = buildHarness(1)
    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 1 })

    await expect(
      harness.add.execute({ ownerId: 'player-42', itemId: 'espada', quantity: 1 }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it.each([
    ['jugador vacio', { ownerId: '  ', itemId: 'pocion', quantity: 1 }],
    ['objeto invalido', { ownerId: 'player-42', itemId: 'Pocion_Grande', quantity: 1 }],
    ['cantidad cero', { ownerId: 'player-42', itemId: 'pocion', quantity: 0 }],
  ])('rechaza una peticion con %s', async (_caso, command) => {
    const harness = buildHarness()

    await expect(harness.add.execute(command)).rejects.toBeInstanceOf(DomainError)
  })
})

describe('RemoveItemFromInventory', () => {
  it('retira unidades y persiste el resultado', async () => {
    const harness = buildHarness()
    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 5 })

    const result = await harness.remove.execute({
      ownerId: 'player-42',
      itemId: 'pocion',
      quantity: 2,
    })

    expect(result.slots).toEqual([{ itemId: 'pocion', quantity: 3 }])
    expect((await harness.get.execute('player-42')).totalUnits).toBe(3)
  })

  it('libera la ranura al agotar el objeto', async () => {
    const harness = buildHarness()
    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 2 })

    const result = await harness.remove.execute({
      ownerId: 'player-42',
      itemId: 'pocion',
      quantity: 2,
    })

    expect(result.slots).toEqual([])
    expect(result.usedSlots).toBe(0)
  })

  it('falla cuando el jugador no tiene inventario', async () => {
    const harness = buildHarness()

    await expect(
      harness.remove.execute({ ownerId: 'player-desconocido', itemId: 'pocion', quantity: 1 }),
    ).rejects.toBeInstanceOf(InventoryNotFoundError)
  })

  it('propaga la falta de unidades como error de dominio', async () => {
    const harness = buildHarness()
    await harness.add.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 1 })

    await expect(
      harness.remove.execute({ ownerId: 'player-42', itemId: 'pocion', quantity: 5 }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('GetInventory', () => {
  it('falla cuando el jugador no tiene inventario', async () => {
    const harness = buildHarness()

    await expect(harness.get.execute('player-desconocido')).rejects.toBeInstanceOf(
      InventoryNotFoundError,
    )
  })

  it('rechaza un identificador vacio', async () => {
    const harness = buildHarness()

    await expect(harness.get.execute('   ')).rejects.toBeInstanceOf(DomainError)
  })
})

describe('InMemoryInventoryRepository', () => {
  it('almacena instantaneas, no referencias vivas al agregado', async () => {
    const repository = new InMemoryInventoryRepository()
    const inventory = Inventory.createEmpty(PlayerId.create('player-42'), CapacityPolicy.of(5))
    inventory.add(ItemId.create('pocion'), Quantity.create(1), FIXED_NOW)
    await repository.save(inventory)

    // Se muta el agregado sin volver a guardarlo.
    inventory.add(ItemId.create('espada'), Quantity.create(1), FIXED_NOW)

    const stored = await repository.findByOwner(PlayerId.create('player-42'))

    expect(stored?.usedSlots).toBe(1)
    expect(inventory.usedSlots).toBe(2)
  })

  it('devuelve null para un jugador desconocido y permite vaciarse', async () => {
    const repository = new InMemoryInventoryRepository()

    expect(await repository.findByOwner(PlayerId.create('player-x'))).toBeNull()

    await repository.save(Inventory.createEmpty(PlayerId.create('player-42'), CapacityPolicy.of(5)))
    expect(repository.size).toBe(1)

    repository.clear()
    expect(repository.size).toBe(0)
  })
})

describe('loadConfig', () => {
  it('aplica valores por defecto seguros para el entorno local', () => {
    expect(loadConfig({})).toMatchObject({
      nodeEnv: 'development',
      serviceName: 'nexus-battle-player-inventory',
      port: 3002,
      persistenceDriver: 'memory',
      databaseUrl: null,
      swaggerEnabled: true,
    })
  })

  it('exige la cadena de conexion cuando el driver es mongo', () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: 'mongo' })).toThrow(/MONGODB_URI es obligatorio/)
  })

  it('acepta una configuracion mongo completa', () => {
    expect(
      loadConfig({
        PERSISTENCE_DRIVER: 'mongo',
        MONGODB_URI: 'mongodb://localhost:27017/player-inventory',
      }).persistenceDriver,
    ).toBe('mongo')
  })

  it('deshabilita la documentacion interactiva en produccion por defecto', () => {
    // Produccion exige autenticacion configurada: `loadConfig` se niega a
    // arrancar sin ella. Se aporta aqui porque el objeto de esta prueba es la
    // documentacion interactiva, no la autenticacion.
    expect(
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'jwt',
        COGNITO_USER_POOL_ID: 'us-east-1_abc',
        COGNITO_CLIENT_ID: 'cliente',
      }).swaggerEnabled,
    ).toBe(false)
  })

  it('trata una variable vacia como ausente', () => {
    expect(loadConfig({ LOG_LEVEL: '', PORT: '' })).toMatchObject({ logLevel: 'info', port: 3002 })
  })

  it.each([
    ['un valor fuera del catalogo', { LOG_LEVEL: 'verbose' }],
    ['un entero mal formado', { PORT: 'abc' }],
    ['un puerto fuera de rango', { PORT: '99999' }],
    ['un booleano invalido', { SWAGGER_ENABLED: 'si' }],
  ])('rechaza %s', (_caso, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigurationError)
  })
})

describe('createLogger', () => {
  it('emite JSON estructurado y respeta el umbral', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'warn',
      service: 'player-inventory',
      version: '0.1.0',
      sink: (line) => lines.push(line),
      clock: () => FIXED_NOW,
    })

    logger.debug('no')
    logger.info('no')
    logger.warn('si', { ownerId: 'player-42' })
    logger.error('si')

    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-08-21T10:00:00.000Z',
      level: 'warn',
      service: 'player-inventory',
      version: '0.1.0',
      message: 'si',
      ownerId: 'player-42',
    })
  })

  it('admite registros sin contexto en todos los niveles', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'debug',
      service: 'player-inventory',
      version: '0.1.0',
      sink: (line) => lines.push(line),
    })

    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')

    expect(lines).toHaveLength(4)
  })
})

describe('sondas de salud y utilidades de sistema', () => {
  it('liveness solo confirma que el proceso responde', () => {
    expect(buildLiveness()).toEqual({ status: 'ok', checks: {} })
  })

  it('readiness distingue exito, fallo y excepcion', () => {
    expect(buildReadiness([{ name: 'repo', check: (): boolean => true }])).toEqual({
      status: 'ok',
      checks: { repo: 'ok' },
    })
    expect(buildReadiness([{ name: 'repo', check: (): boolean => false }]).status).toBe('error')
    expect(
      buildReadiness([
        {
          name: 'repo',
          check: (): boolean => {
            throw new Error('sin conexion')
          },
        },
      ]),
    ).toEqual({ status: 'error', checks: { repo: 'error' } })
  })

  it('version expone servicio, version y entorno', () => {
    expect(buildVersion({ service: 'a', version: 'b', nodeEnv: 'c' })).toEqual({
      service: 'a',
      version: 'b',
      nodeEnv: 'c',
    })
  })

  it('el reloj y el generador de identificadores funcionan', () => {
    expect(new SystemClock().now().getTime()).toBeGreaterThan(0)
    expect(new UuidGenerator().generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
