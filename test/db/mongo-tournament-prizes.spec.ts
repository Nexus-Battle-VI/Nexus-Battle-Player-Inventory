import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { MongoClient, type Db } from 'mongodb'
import { Test } from '@nestjs/testing'
import type { Response } from 'express'
import {
  AppModule,
  APP_CONFIG,
  MONGO_DATABASE,
} from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { migrateToLatest } from '../../src/infrastructure/persistence/database'
import { MongoTournamentPrizeRepository } from '../../src/adapters/outbound/persistence/MongoTournamentPrizeRepository'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { CATALOG_READ } from '../../src/application/ports/CatalogReadPort'
import { GrantTournamentPrize } from '../../src/application/use-cases/GrantTournamentPrize'
import {
  InventoryGrantConflictError,
  InventoryConcurrentWriteError,
} from '../../src/application/ports/InventoryGrantPort'
import type {
  TournamentPrizeCommand,
  TournamentPrizeReceipt,
} from '../../src/application/ports/TournamentPrizePort'
import { Inventory } from '../../src/domain/entities/Inventory'
import { PlayerId, ItemId, Quantity } from '../../src/domain/value-objects/identifiers'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { QA_HERO_ID, QA_EPIC_ID, qaCommand, qaHero, qaEpic } from '../fixtures/tournament-prize'

describe('HU-86 contra MongoDB real (QA-HU86-INVENTORY-v1)', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  let uri: string
  const catalog = new InMemoryCatalogReadClient([qaHero, qaEpic])
  const command = (): TournamentPrizeCommand => ({
    ...qaCommand(randomUUID()),
    playerId: `qa-${randomUUID()}`,
  })
  const prepare = async (c: TournamentPrizeCommand, capacity = 200) => {
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(c.playerId),
        capacity,
        slots: [{ itemId: QA_HERO_ID, quantity: 1 }],
      }),
    )
    return new GrantTournamentPrize(
      new MongoTournamentPrizeRepository(db),
      new MongoInventoryRepository(db),
      catalog,
    )
  }
  const quantity = async (c: TournamentPrizeCommand) => {
    const inventory = await new MongoInventoryRepository(db).findByOwner(
      PlayerId.create(c.playerId),
    )
    return inventory?.toSnapshot().slots.find((s) => s.itemId === QA_EPIC_ID)?.quantity ?? 0
  }
  beforeAll(async () => {
    if (process.env.MONGO_TEST_URI === undefined)
      container = await new MongoDBContainer('mongo:8.0').start()
    uri = process.env.MONGO_TEST_URI ?? `${container!.getConnectionString()}/?directConnection=true`
    client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 })
    await client.connect()
    db = client.db(`qa_hu86_${randomUUID().replaceAll('-', '')}`)
    const outcome = await migrateToLatest(db)
    if (outcome.error !== undefined)
      throw new Error('Fallo de migracion QA', { cause: outcome.error })
  }, 180000)
  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  it('replay, veinte solicitudes y pool nuevo conceden una unidad y recibo estable', async () => {
    const c = command()
    const useCase = await prepare(c)
    const receipts = await Promise.all(Array.from({ length: 20 }, () => useCase.execute(c)))
    for (const receipt of receipts) expect(receipt).toEqual(receipts[0])
    const nextClient = new MongoClient(uri)
    await nextClient.connect()
    try {
      const restarted = new MongoTournamentPrizeRepository(nextClient.db(db.databaseName))
      expect(await restarted.find(c)).toEqual(receipts[0])
      expect(await restarted.grant(c, QA_HERO_ID)).toEqual(receipts[0])
    } finally {
      await nextClient.close()
    }
    expect(await quantity(c)).toBe(1)
    expect(
      await db.collection('inventory_grants').countDocuments({ _id: c.operationId as never }),
    ).toBe(1)
    expect(
      await db
        .collection('tournament_prize_grants')
        .countDocuments({ _id: c.operationId as never }),
    ).toBe(1)
    expect(await db.collection('hero-epic-selections').countDocuments()).toBe(0)
  })
  it('dos procesos con pools independientes recuperan el mismo recibo', async () => {
    const c = command()
    await prepare(c)
    // Transpila los mismos fuentes en procesos separados con la dependencia
    // TypeScript existente; no usa ts-node ni introduce un doble del repositorio.
    const loader = `
      const fs = require('node:fs');
      const ts = require(${JSON.stringify(require.resolve('typescript'))});
      require.extensions['.ts'] = (module, filename) => module._compile(
        ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
          fileName: filename,
        }).outputText, filename);
      require(process.argv[1]);
    `
    const children = [0, 1].map(() =>
      spawn(
        process.execPath,
        ['-e', loader, path.join(__dirname, '../support/tournament-prize-worker.ts')],
        {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
      ),
    )
    try {
      const ready = children.map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            child.once('error', reject)
            let stderr = ''
            child.stderr?.on('data', (chunk: Buffer) => {
              stderr += chunk.toString()
            })
            child.once('exit', (code) => {
              if (code !== 0) reject(new Error(stderr || 'Worker QA fallo.'))
            })
            child.on('message', (m: { ready?: boolean; error?: string }) => {
              if (m.error) reject(new Error(m.error))
              if (m.ready) resolve()
            })
            child.send({ uri, databaseName: db.databaseName, command: c, heroItemId: QA_HERO_ID })
          }),
      )
      await Promise.all(ready)
      const receipts = children.map(
        (child) =>
          new Promise<TournamentPrizeReceipt>((resolve, reject) => {
            child.on('message', (m: { receipt?: TournamentPrizeReceipt; error?: string }) => {
              if (m.error) reject(new Error(m.error))
              if (m.receipt) resolve(m.receipt)
            })
            child.send({ go: true })
          }),
      )
      const results = await Promise.all(receipts)
      expect(results[1]).toEqual(results[0])
      expect(await quantity(c)).toBe(1)
    } finally {
      for (const child of children) child.kill()
    }
  })
  it.each([
    'productId',
    'playerId',
    'heroId',
    'tournamentId',
    'championTeamId',
    'finalEncounterId',
    'finalRoomId',
  ])('otro %s con operationId confirmado es 409 aun antes de Catalog', async (field) => {
    const c = command()
    const useCase = await prepare(c)
    await useCase.execute(c)
    await expect(useCase.execute({ ...c, [field]: randomUUID() })).rejects.toMatchObject({
      code: 'OPERATION_ID_REUSED',
      status: 409,
    })
    expect(await quantity(c)).toBe(1)
  })
  it('colision con concesiones existentes se rechaza en ambos sentidos', async () => {
    const first = command()
    const useCase = await prepare(first)
    const purchases = new MongoInventoryRepository(db)
    await purchases.grant({
      operationId: first.operationId,
      playerId: first.playerId,
      items: [{ productId: QA_EPIC_ID, quantity: 1 }],
    })
    await expect(useCase.execute(first)).rejects.toMatchObject({ code: 'OPERATION_ID_REUSED' })
    const second = command()
    await (await prepare(second)).execute(second)
    await expect(
      purchases.grant({
        operationId: second.operationId,
        playerId: second.playerId,
        items: [{ productId: QA_EPIC_ID, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(InventoryGrantConflictError)
    expect(await quantity(first)).toBe(1)
    expect(await quantity(second)).toBe(1)
  })
  it('recomprueba propiedad al commit y no crea un inventario/heroe de rescate', async () => {
    const c = command()
    await prepare(c)
    await db.collection('inventories').deleteOne({ _id: c.playerId as never })
    await expect(new MongoTournamentPrizeRepository(db).grant(c, QA_HERO_ID)).rejects.toMatchObject(
      { code: 'PRIZE_INVALID' },
    )
    expect(
      await db.collection('inventory_grants').countDocuments({ _id: c.operationId as never }),
    ).toBe(0)
    expect(await db.collection('inventories').countDocuments({ _id: c.playerId as never })).toBe(0)
  })
  it('capacidad rechazada queda recuperable con el mismo derecho', async () => {
    const c = command()
    const useCase = await prepare(c, 1)
    await expect(useCase.execute(c)).rejects.toMatchObject({ code: 'PRIZE_INVALID' })
    expect(await quantity(c)).toBe(0)
    // QA cambia capacidad; no se modifica la propiedad ni la orden de premio.
    await db
      .collection('inventories')
      .updateOne({ _id: c.playerId as never }, { $set: { capacity: 2 } })
    expect((await useCase.execute(c)).status).toBe('DELIVERED')
    expect(await quantity(c)).toBe(1)
  })
  it('fallo del motor antes del commit revierte item, operacion y recibo', async () => {
    const c = command()
    const useCase = await prepare(c)
    const collections = await db.listCollections({ name: 'tournament_prize_grants' }).toArray()
    const collection = collections[0]!
    if (!('options' in collection)) throw new Error('Falta informacion del validador QA.')
    const validator = collection.options?.validator
    await db.command({
      collMod: 'tournament_prize_grants',
      validator: { $jsonSchema: { bsonType: 'object', required: ['qa_force_failure'] } },
    })
    try {
      await expect(useCase.execute(c)).rejects.toMatchObject({
        code: 'PRIZE_DEPENDENCY_UNAVAILABLE',
        status: 503,
      })
      expect(await quantity(c)).toBe(0)
      expect(
        await db.collection('inventory_grants').countDocuments({ _id: c.operationId as never }),
      ).toBe(0)
      expect(
        await db
          .collection('tournament_prize_grants')
          .countDocuments({ _id: c.operationId as never }),
      ).toBe(0)
    } finally {
      await db.command({ collMod: 'tournament_prize_grants', validator })
    }
    expect((await useCase.execute(c)).status).toBe('DELIVERED')
    expect(await quantity(c)).toBe(1)
  })
  it('perder la respuesta despues del commit se recupera al reiniciar el servicio', async () => {
    const c = command()
    await prepare(c)
    const secret = 'qa-hu86-not-operational'
    const route = '/api/internal/v1/inventory/tournament-prizes'
    const createApp = async (loseResponse: boolean) => {
      const httpClient = new MongoClient(uri)
      await httpClient.connect()
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(
          loadConfig({
            AUTH_MODE: 'disabled',
            PERSISTENCE_DRIVER: 'mongo',
            MONGODB_URI: uri,
            INTERNAL_SERVICE_AUTH_SECRET: secret,
            LOG_LEVEL: 'error',
          }),
        )
        .overrideProvider(MONGO_DATABASE)
        .useValue(httpClient.db(db.databaseName))
        .overrideProvider(CATALOG_READ)
        .useValue(catalog)
        .compile()
      const app = moduleRef.createNestApplication()
      app.setGlobalPrefix('api')
      if (loseResponse)
        app.use(route, (_req: unknown, res: Response, next: () => void) => {
          const json = res.json.bind(res)
          res.json = (body: { status?: string }): Response => {
            if (body.status === 'DELIVERED') {
              res.socket?.destroy()
              return res
            }
            return json(body)
          }
          next()
        })
      await app.listen(0, '127.0.0.1')
      return app
    }
    const send = (base: string) => {
      const timestamp = String(Date.now())
      return fetch(new URL(route, base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-service': 'tournament',
          'x-internal-timestamp': timestamp,
          'x-internal-signature': signInternalRequest(secret, {
            service: 'tournament',
            method: 'POST',
            path: route,
            timestamp,
            body: c,
          }),
        },
        body: JSON.stringify(c),
        signal: AbortSignal.timeout(5000),
      })
    }
    const first = await createApp(true)
    try {
      await expect(send(await first.getUrl())).rejects.toThrow()
    } finally {
      await first.close()
    }
    const persisted = await new MongoTournamentPrizeRepository(db).find(c)
    expect(persisted).not.toBeNull()
    const restarted = await createApp(false)
    try {
      const response = await send(await restarted.getUrl())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(persisted)
    } finally {
      await restarted.close()
    }
    expect(await quantity(c)).toBe(1)
  })
  it('guardado legacy de equipamiento/inventario no sobrescribe el premio confirmado', async () => {
    const c = command()
    const useCase = await prepare(c)
    const repository = new MongoInventoryRepository(db)
    const stale = (await repository.findByOwner(PlayerId.create(c.playerId)))!
    await useCase.execute(c)
    stale.add(ItemId.create('qa-legacy'), Quantity.create(1), new Date())
    await expect(repository.save(stale)).rejects.toBeInstanceOf(InventoryConcurrentWriteError)
    expect(await quantity(c)).toBe(1)
  })
  it('indices y validador rechazan duplicados y recibos incompletos en el motor', async () => {
    const c = command()
    await (await prepare(c)).execute(c)
    const grants = db.collection<Record<string, unknown> & { _id: string }>(
      'tournament_prize_grants',
    )
    const document = (await grants.findOne({ _id: c.operationId }))!
    await expect(grants.insertOne(document)).rejects.toMatchObject({ code: 11000 })
    await expect(grants.insertOne({ ...document, _id: randomUUID() })).rejects.toMatchObject({
      code: 11000,
    })
    await expect(
      grants.insertOne({
        _id: randomUUID(),
        fingerprint: 'bad',
        grantedAt: new Date(),
        receipt: {},
      }),
    ).rejects.toMatchObject({ code: 121 })
    const indexes = await grants.listIndexes().toArray()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'tournament_prize_receipt_unique', unique: true }),
      ]),
    )
  })
  it('registro sin recibo no permite inventar entrega ni mutar datos', async () => {
    const c = command()
    await (await prepare(c)).execute(c)
    await db.collection('tournament_prize_grants').deleteOne({ _id: c.operationId as never })
    await expect(new MongoTournamentPrizeRepository(db).find(c)).rejects.toMatchObject({
      code: 'PRIZE_DEPENDENCY_UNAVAILABLE',
    })
    expect(await quantity(c)).toBe(1)
  })
})
