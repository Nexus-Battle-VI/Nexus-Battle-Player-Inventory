import 'reflect-metadata'
import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { Int32, type Collection, type Db, type MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'

/** Documento suelto, con el propietario como clave, para escribir sin el dominio. */
type DocumentoDePrueba = Record<string, unknown> & { _id: string }

/**
 * Adaptador de MongoDB contra un motor REAL, en contenedor.
 *
 * Estas pruebas viven aparte de la suite por defecto porque necesitan Docker.
 * Lo que comprueban no se puede comprobar de otra forma: que el validador
 * exista de verdad, que el documento tenga la forma que se cree, y que el tipo
 * de los recuentos sea el que se declaro. Un doble de prueba habria pasado con
 * un esquema equivocado.
 */
describe('MongoInventoryRepository', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  let repository: MongoInventoryRepository

  let contador = 0

  const buildInventory = (): Inventory => {
    contador += 1

    return Inventory.createEmpty(
      PlayerId.create(`jugador-${String(contador)}`),
      CapacityPolicy.default(),
    )
  }

  const add = (inventory: Inventory, itemId: string, quantity: number): void => {
    inventory.add(ItemId.create(itemId), Quantity.create(quantity), new Date())
  }

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()

    // `directConnection` porque Testcontainers levanta un conjunto de replicas
    // de un solo nodo: sin esto el driver intentaria descubrir la topologia y
    // se quedaria esperando a miembros que no existen.
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_inventory_${randomUUID().replaceAll('-', '')}`,
    }

    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }
  }, 180_000)

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  beforeEach(() => {
    repository = new MongoInventoryRepository(db)
  })

  /**
   * Acceso directo a la coleccion, tipado con el propietario como clave. Sin el
   * parametro de tipo, el driver asume `_id: ObjectId`, que es su valor por
   * defecto pero no lo que este modelo usa.
   */
  const inventarios = (): Collection<DocumentoDePrueba> =>
    db.collection<DocumentoDePrueba>('inventories')

  it('guarda y recupera un inventario vacio', async () => {
    const inventory = buildInventory()
    await repository.save(inventory)

    const found = await repository.findByOwner(inventory.ownerId)

    expect(found?.toSnapshot()).toEqual(inventory.toSnapshot())
  })

  it('guarda y recupera un inventario con sus ranuras', async () => {
    const inventory = buildInventory()
    add(inventory, 'pocion-de-vida', 5)
    add(inventory, 'espada-corta', 1)
    await repository.save(inventory)

    const found = await repository.findByOwner(inventory.ownerId)

    expect(found?.toSnapshot()).toEqual(inventory.toSnapshot())
  })

  it('devuelve null cuando el jugador no tiene inventario', async () => {
    expect(await repository.findByOwner(PlayerId.create('jugador-sin-nada'))).toBeNull()
  })

  /**
   * El mismo contrato que cumple el repositorio en memoria: una mutacion que no
   * se guarda NO debe filtrarse al almacen. Es lo que hace que una prueba falle
   * cuando un caso de uso olvida llamar a `save`.
   */
  it('no filtra al almacen una mutacion sin guardar', async () => {
    const inventory = buildInventory()
    await repository.save(inventory)

    add(inventory, 'pocion-fantasma', 1)

    const found = await repository.findByOwner(inventory.ownerId)

    expect(found?.toSnapshot().slots).toEqual([])
  })

  it('actualiza el inventario existente en lugar de duplicarlo', async () => {
    const inventory = buildInventory()
    add(inventory, 'pocion-de-vida', 2)
    await repository.save(inventory)

    add(inventory, 'pocion-de-vida', 3)
    await repository.save(inventory)

    const found = await repository.findByOwner(inventory.ownerId)

    expect(found?.toSnapshot().slots).toEqual([{ itemId: 'pocion-de-vida', quantity: 5 }])
    expect(await inventarios().countDocuments({ _id: inventory.ownerId.value })).toBe(1)
  })

  /**
   * `replaceOne` y no operadores de array: el agregado es la autoridad sobre
   * TODO su contenido. Con una actualizacion parcial, una ranura o un campo
   * sobrante de una version anterior del servicio sobreviviria al guardado.
   */
  it('reemplaza el documento entero y no deja nada sobrante', async () => {
    const inventory = buildInventory()
    add(inventory, 'pocion-de-vida', 1)
    await repository.save(inventory)

    // Se escribe basura saltandose el validador, que es lo que dejaria una
    // version anterior del servicio con otro modelo.
    await inventarios().updateOne(
      { _id: inventory.ownerId.value },
      { $set: { sobrante: 'basura' } },
      { bypassDocumentValidation: true },
    )

    await repository.save(inventory)

    const documento = await inventarios().findOne({ _id: inventory.ownerId.value })

    expect(documento).not.toBeNull()
    expect(Object.keys(documento!)).not.toContain('sobrante')
  })

  /**
   * Retirar un objeto tiene que borrar la ranura de verdad. Con operadores
   * parciales seria facil dejarla con cantidad cero, que el dominio no admite.
   */
  it('retira del almacen la ranura que el agregado ya no tiene', async () => {
    const inventory = buildInventory()
    add(inventory, 'pocion-de-vida', 2)
    add(inventory, 'espada-corta', 1)
    await repository.save(inventory)

    inventory.remove(ItemId.create('espada-corta'), Quantity.create(1), new Date())
    await repository.save(inventory)

    const found = await repository.findByOwner(inventory.ownerId)

    expect(found?.toSnapshot().slots).toEqual([{ itemId: 'pocion-de-vida', quantity: 2 }])
  })

  /**
   * Un recuento no es un numero con decimales. Se le pregunta al MOTOR por el
   * tipo BSON almacenado, en vez de mirar lo que devuelve el driver: eso ultimo
   * dependeria de como este configurada la promocion de enteros, que es
   * precisamente lo que no debe decidir si la prueba pasa.
   */
  it('guarda los recuentos como enteros de 32 bits, no como dobles', async () => {
    const inventory = buildInventory()
    add(inventory, 'pocion-de-vida', 7)
    await repository.save(inventory)

    const comoInt = await inventarios().countDocuments({
      _id: inventory.ownerId.value,
      capacity: { $type: 'int' },
      'slots.quantity': { $type: 'int' },
    })

    expect(comoInt).toBe(1)
  })

  /**
   * Una coleccion de MongoDB acepta documentos de cualquier forma salvo que se
   * declare un validador. Estas pruebas escriben directamente en la coleccion,
   * sin pasar por el agregado: es la unica forma de demostrar que la proteccion
   * esta en el motor.
   */
  describe('El validador vive en el motor, no solo en el codigo', () => {
    const escribir = (documento: DocumentoDePrueba): Promise<unknown> =>
      inventarios().insertOne(documento)

    const valido = (): DocumentoDePrueba => {
      contador += 1

      return {
        _id: `jugador-validador-${String(contador)}`,
        capacity: new Int32(30),
        slots: [{ itemId: 'pocion-de-vida', quantity: new Int32(1) }],
      }
    }

    it('admite un documento con la forma correcta', async () => {
      await expect(escribir(valido())).resolves.toBeDefined()
    })

    it('rechaza una capacidad que no es entera de 32 bits', async () => {
      await expect(escribir({ ...valido(), capacity: 30.5 })).rejects.toThrow()
    })

    it.each([
      ['cero', 0],
      ['por encima del maximo del dominio', CapacityPolicy.MAX_CAPACITY + 1],
    ])('rechaza una capacidad %s', async (_caso, capacity) => {
      await expect(escribir({ ...valido(), capacity: new Int32(capacity) })).rejects.toThrow()
    })

    it.each([
      ['cero', 0],
      ['por encima del maximo del dominio', Quantity.MAX + 1],
    ])('rechaza una cantidad %s', async (_caso, quantity) => {
      const documento = {
        ...valido(),
        slots: [{ itemId: 'pocion-de-vida', quantity: new Int32(quantity) }],
      }

      await expect(escribir(documento)).rejects.toThrow()
    })

    it.each([
      ['en mayusculas', 'POCION'],
      ['con espacios', 'pocion de vida'],
      ['que empieza por guion', '-pocion'],
    ])('rechaza un objeto %s', async (_caso, itemId) => {
      const documento = { ...valido(), slots: [{ itemId, quantity: new Int32(1) }] }

      await expect(escribir(documento)).rejects.toThrow()
    })

    it('rechaza un campo que el modelo no declara', async () => {
      await expect(escribir({ ...valido(), inventado: 'valor' })).rejects.toThrow()
    })

    it('rechaza un campo de mas dentro de una ranura', async () => {
      const documento = {
        ...valido(),
        slots: [{ itemId: 'pocion-de-vida', quantity: new Int32(1), sobrante: 1 }],
      }

      await expect(escribir(documento)).rejects.toThrow()
    })

    it('rechaza un documento al que le falta un campo obligatorio', async () => {
      const incompleto = valido()
      delete incompleto.slots

      await expect(escribir(incompleto)).rejects.toThrow()
    })

    /**
     * Estas dos SI pasan el validador, y es lo esperado: `$jsonSchema` no sabe
     * expresar "sin repetidos por una propiedad" ni comparar un campo con otro.
     * Las detecta la traduccion al leer, y es importante comprobar que el
     * reparto de responsabilidades es el que se documento y no otro.
     */
    it('deja pasar un objeto repetido, que detecta la lectura', async () => {
      const documento = {
        ...valido(),
        slots: [
          { itemId: 'pocion-de-vida', quantity: new Int32(1) },
          { itemId: 'pocion-de-vida', quantity: new Int32(2) },
        ],
      }

      await expect(escribir(documento)).resolves.toBeDefined()
      await expect(repository.findByOwner(PlayerId.create(documento._id))).rejects.toThrow(
        /repite el objeto/,
      )
    })

    it('deja pasar mas ranuras que capacidad, que detecta la lectura', async () => {
      const documento = {
        ...valido(),
        capacity: new Int32(1),
        slots: [
          { itemId: 'pocion-de-vida', quantity: new Int32(1) },
          { itemId: 'espada-corta', quantity: new Int32(1) },
        ],
      }

      await expect(escribir(documento)).resolves.toBeDefined()
      await expect(repository.findByOwner(PlayerId.create(documento._id))).rejects.toThrow(
        /ranuras y una capacidad/,
      )
    })
  })

  it('la migracion es idempotente: volver a aplicarla no cambia nada', async () => {
    const { applied, error } = await migrateToLatest(db)

    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })

  /**
   * Una reclamacion sin completar significa que una ejecucion anterior murio a
   * medias. Seguir escribiendo encima de un esquema en estado desconocido lo
   * empeora, asi que el migrador falla y dice cual.
   */
  it('se niega a continuar si una migracion anterior quedo a medias', async () => {
    const registro = db.collection<{ _id: string; completedAt?: Date }>('_migrations')
    const original = await registro.findOne({ _id: '001-inventories' })

    await registro.updateOne({ _id: '001-inventories' }, { $unset: { completedAt: '' } })

    try {
      const { error } = await migrateToLatest(db)

      expect(describeError(error)).toContain('quedo a medias')
    } finally {
      await registro.updateOne(
        { _id: '001-inventories' },
        { $set: { completedAt: original?.completedAt ?? new Date() } },
      )
    }
  })
})
