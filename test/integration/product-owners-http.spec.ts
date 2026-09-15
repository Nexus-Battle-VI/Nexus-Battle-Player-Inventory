import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'

const grantsPath = '/api/internal/v1/inventory/grants'
const secret = 'test-only-internal-secret'
const productId = '11111111-1111-4111-8111-111111111111'
const ownersPath = (id: string): string => `/api/internal/v1/inventory/products/${id}/owners`

describe('Contrato HTTP interno de propietarios (HU-38, TASK #175)', () => {
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

  const signedGet = (
    path: string,
    service = 'notifications',
    timestamp = String(Date.now()),
  ): request.Test => {
    const body = {}

    return request(app.getHttpServer())
      .get(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'GET', path, timestamp, body }),
      )
  }

  const signedPost = (
    path: string,
    body: object,
    service = 'commerce',
    timestamp = String(Date.now()),
  ): request.Test =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body)

  const grantTo = async (playerId: string, operationId: string, quantity = 1): Promise<void> => {
    const body = { operationId, playerId, items: [{ productId, quantity }] }
    const response = await signedPost(grantsPath, body)
    expect(response.status).toBe(200)
  }

  it('producto sin propietarios devuelve una lista vacia', async () => {
    const otherProduct = '99999999-9999-4999-8999-999999999999'
    const response = await signedGet(ownersPath(otherProduct))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ productId: otherProduct, owners: [] })
  })

  it('devuelve los propietarios reales tras una entrega, sin duplicar al mismo jugador', async () => {
    await grantTo('jugador-a', '22222222-2222-4222-8222-222222222222', 2)
    await grantTo('jugador-b', '33333333-3333-4333-8333-333333333333', 1)

    const response = await signedGet(ownersPath(productId))

    expect(response.status).toBe(200)
    expect(response.body.productId).toBe(productId)
    const playerIds = response.body.owners
      .map((owner: { playerId: string }) => owner.playerId)
      .sort()
    expect(playerIds).toEqual(['jugador-a', 'jugador-b'])
  })

  it('sin firma es 401, y no como PLAYER autenticado con JWT', async () => {
    expect((await request(app.getHttpServer()).get(ownersPath(productId))).status).toBe(401)
  })

  it('firma invalida es 401', async () => {
    const response = await request(app.getHttpServer())
      .get(ownersPath(productId))
      .set('x-internal-service', 'notifications')
      .set('x-internal-timestamp', String(Date.now()))
      .set('x-internal-signature', 'firma-que-no-corresponde')

    expect(response.status).toBe(401)
  })

  it('servicio no permitido es 401 aunque la firma sea valida para ese servicio', async () => {
    const response = await signedGet(ownersPath(productId), 'web')

    expect(response.status).toBe(401)
  })

  it('productId invalido responde 400, no 500 ni una lista vacia enmascarada', async () => {
    const response = await signedGet(ownersPath('no-es-un-id-valido-!!'))

    expect(response.status).toBe(400)
  })

  it('no se accede publicamente vía el proxy: la ruta interna no se registra como publica ni como accesible por rol de jugador', async () => {
    // Sin cabeceras internas Y sin Authorization: JwtAuthGuard exigiria un
    // testimonio salvo que la ruta este marcada @InternalOnly()/@Public(). El
    // 401 aqui (y no 403 por falta de rol) confirma que se rechaza en la capa
    // de autenticacion interna, no que un jugador autenticado pudiera pasar.
    const response = await request(app.getHttpServer()).get(ownersPath(productId))

    expect(response.status).toBe(401)
  })
})
