import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'

const path = '/api/internal/v1/inventory/grants'
const secret = 'test-only-internal-secret'
const body = {
  operationId: '22222222-2222-4222-8222-222222222222',
  playerId: 'player-a',
  items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
}

describe('Contrato HTTP interno de entrega', () => {
  let app: INestApplication
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'jwt',
          COGNITO_USER_POOL_ID: 'us-east-1_test',
          COGNITO_CLIENT_ID: 'test',
          INTERNAL_SERVICE_AUTH_SECRET: secret,
        }),
      )
      .compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })
  afterAll(async () => {
    await app.close()
  })
  const signed = (payload = body, service = 'commerce', timestamp = String(Date.now())) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'POST', path, timestamp, body: payload }),
      )
      .send(payload)

  it('exige HMAC incluso sin bearer y registra una sola entrega', async () => {
    expect((await request(app.getHttpServer()).post(path).send(body)).status).toBe(401)
    const first = await signed()
    const replay = await signed()
    expect(first.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(first.body.applied).toBe(true)
  })
  it('rechaza servicio ajeno y sello vencido', async () => {
    expect((await signed(body, 'web')).status).toBe(401)
    expect((await signed(body, 'commerce', '0')).status).toBe(401)
  })
  it('acepta a combat como llamador autorizado (HU-22: entrega del cofre reutiliza este contrato)', async () => {
    // 'combat' entro al allow-list para HU-15 (heroe equipado), pero el guard
    // es GLOBAL a todas las rutas @InternalOnly(): por eso ya autoriza
    // tambien esta ruta, sin cambiar el codigo para HU-22. Esta prueba deja
    // esa dependencia expresa: si alguien retira 'combat' pensando que solo
    // sirve para HU-15, esto rompe y avisa.
    const response = await signed(
      {
        ...body,
        operationId: '44444444-4444-4444-8444-444444444444',
      },
      'combat',
    )
    expect(response.status).toBe(200)
    expect(response.body.applied).toBe(true)
  })
  it('acepta a missions para la recompensa epica y conserva la idempotencia', async () => {
    const payload = { ...body, operationId: '55555555-5555-4555-8555-555555555555' }
    const first = await signed(payload, 'missions')
    const replay = await signed(payload, 'missions')

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ operationId: payload.operationId, applied: true })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
  })

  describe('HU-22: el operationId que llega de Combat debe ser UUID', () => {
    // Identificadores de ejemplo con la forma real (batalla UUID, `sub` de Cognito, producto del Catalog).
    const battleId = '5b1d3c0e-7a2f-4e6b-9c1d-2f8a4b6c7d01'
    const playerId = '9f3a1c2e-4b5d-4e7f-8a9b-0c1d2e3f4a5b'
    const productId = '6a96d059-88c1-4702-8f07-8410f98707a3'
    const chest = (operationId: string) => ({
      operationId,
      playerId,
      items: [{ productId, quantity: 1 }],
    })

    it('el id LOGICO del workflow (battle:...:chest:1:grant) NO es UUID: se rechaza con 400', async () => {
      // Es exactamente lo que Combat enviaba antes de traducirlo. El contrato de
      // HU-59 exige UUID v1-5, y este 400 salta en el DTO, ANTES del controlador:
      // por eso Player-Inventory no registraba ningun error propio. Si algun dia se
      // relaja el contrato, esta prueba debe cambiarse a proposito, junto con el
      // mapeo de Combat (`toInventoryGrantOperationId`) y la doc.
      const response = await signed(
        chest(`battle:${battleId}:player:${playerId}:chest:1:grant`),
        'combat',
      )

      expect(response.status).toBe(400)
      expect(response.body.message).toContain('operationId must be a UUID')
    })

    it('el UUID v5 que Combat deriva de ese id logico SI se acepta y su replay es estable', async () => {
      // Valor calculado por Combat (`toInventoryGrantOperationId`, UUID v5 con su
      // espacio de nombres fijo). Fijarlo aqui es el "control" de la prueba de arriba:
      // la MISMA entrega, con un operationId valido, pasa.
      const wireId = '4cbcac78-eb3d-51b9-b37a-4b66515477e9'

      const first = await signed(chest(wireId), 'combat')
      const replay = await signed(chest(wireId), 'combat')

      expect(first.status).toBe(200)
      expect(first.body.applied).toBe(true)
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(first.body)
    })
  })
  it('rechaza cambio de payload y no confunde conflicto con entrega rechazada', async () => {
    expect((await signed({ ...body, playerId: 'player-b' })).status).toBe(409)
    const tooMany = {
      ...body,
      operationId: '33333333-3333-4333-8333-333333333333',
      items: Array.from({ length: 31 }, (_, index) => ({
        productId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        quantity: 1,
      })),
    }
    const rejected = await signed(tooMany)
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('INVENTORY_REJECTED')
  })
})
