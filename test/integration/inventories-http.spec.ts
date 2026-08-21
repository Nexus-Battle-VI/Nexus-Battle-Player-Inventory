import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'

/**
 * Pruebas de integracion sobre la aplicacion NestJS real: se levanta el modulo
 * completo, con su raiz de composicion, sus tuberias de validacion y sus
 * controladores. No se sustituye ningun adaptador.
 */
describe('API de inventarios', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )

    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const addItem = (owner: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/inventories/${owner}/items`).send(body)

  const removeItem = (owner: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/inventories/${owner}/items/removals`).send(body)

  it('crea el inventario al primer alta y responde 200', async () => {
    const response = await addItem('player-1', { itemId: 'espada-de-hierro', quantity: 2 })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      ownerId: 'player-1',
      usedSlots: 1,
      totalUnits: 2,
      slots: [{ itemId: 'espada-de-hierro', quantity: 2 }],
    })
  })

  it('apila sobre la ranura existente sin consumir capacidad', async () => {
    await addItem('player-2', { itemId: 'pocion', quantity: 3 })

    const response = await addItem('player-2', { itemId: 'pocion', quantity: 4 })

    expect(response.status).toBe(200)
    expect(response.body.usedSlots).toBe(1)
    expect(response.body.slots).toEqual([{ itemId: 'pocion', quantity: 7 }])
  })

  it('rechaza un identificador de objeto mal formado', async () => {
    const response = await addItem('player-3', { itemId: 'Pocion_Grande', quantity: 1 })

    expect(response.status).toBe(400)
  })

  it('rechaza una cantidad no positiva', async () => {
    expect((await addItem('player-3', { itemId: 'pocion', quantity: 0 })).status).toBe(400)
    expect((await addItem('player-3', { itemId: 'pocion', quantity: -2 })).status).toBe(400)
  })

  it('rechaza campos no declarados en el contrato', async () => {
    const response = await addItem('player-3', {
      itemId: 'pocion',
      quantity: 1,
      capacity: 9999,
    })

    expect(response.status).toBe(400)
  })

  it('recupera el inventario de un jugador', async () => {
    await addItem('player-4', { itemId: 'arco', quantity: 1 })

    const response = await request(app.getHttpServer()).get('/api/inventories/player-4')

    expect(response.status).toBe(200)
    expect(response.body.slots).toEqual([{ itemId: 'arco', quantity: 1 }])
  })

  it('responde 404 para un jugador sin inventario', async () => {
    const response = await request(app.getHttpServer()).get('/api/inventories/player-sin-nada')

    expect(response.status).toBe(404)
  })

  it('retira unidades y libera la ranura al agotarlas', async () => {
    await addItem('player-5', { itemId: 'pocion', quantity: 2 })

    const parcial = await removeItem('player-5', { itemId: 'pocion', quantity: 1 })
    expect(parcial.status).toBe(200)
    expect(parcial.body.slots).toEqual([{ itemId: 'pocion', quantity: 1 }])

    const total = await removeItem('player-5', { itemId: 'pocion', quantity: 1 })
    expect(total.status).toBe(200)
    expect(total.body.slots).toEqual([])
    expect(total.body.usedSlots).toBe(0)
  })

  it('responde 400 al retirar mas unidades de las disponibles', async () => {
    await addItem('player-6', { itemId: 'pocion', quantity: 1 })

    expect((await removeItem('player-6', { itemId: 'pocion', quantity: 5 })).status).toBe(400)
  })

  it('responde 400 al retirar un objeto ausente', async () => {
    await addItem('player-7', { itemId: 'pocion', quantity: 1 })

    expect((await removeItem('player-7', { itemId: 'escudo', quantity: 1 })).status).toBe(400)
  })

  it('responde 404 al retirar de un jugador sin inventario', async () => {
    expect((await removeItem('player-vacio', { itemId: 'pocion', quantity: 1 })).status).toBe(404)
  })
})

describe('Sondas de salud', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/health/live responde 200', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: {} })
  })

  it('GET /api/health/ready evalua las dependencias reales', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: { 'inventories-repository': 'ok' } })
  })

  it('GET /api/version expone servicio, version y entorno', async () => {
    const response = await request(app.getHttpServer()).get('/api/version')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ service: 'nexus-battle-player-inventory' })
  })
})
