import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import request from 'supertest'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import {
  TOURNAMENT_PRIZES,
  TournamentPrizeError,
} from '../../src/application/ports/TournamentPrizePort'
import { CATALOG_READ } from '../../src/application/ports/CatalogReadPort'
import { INVENTORY_REPOSITORY } from '../../src/application/ports/InventoryRepositoryPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { Inventory } from '../../src/domain/entities/Inventory'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { QA_HERO_ID, qaCommand, qaEpic, qaHero } from '../fixtures/tournament-prize'

const PATH = '/api/internal/v1/inventory/tournament-prizes'
const SECRET = 'qa-hu86-fixture-secret-not-operational'
const config = (secret = SECRET) =>
  loadConfig({
    AUTH_MODE: 'jwt',
    COGNITO_USER_POOL_ID: 'us-east-1_qa',
    COGNITO_CLIENT_ID: 'qa-client',
    PERSISTENCE_DRIVER: 'memory',
    INTERNAL_SERVICE_AUTH_SECRET: secret,
    LOG_LEVEL: 'error',
  })

describe('HU-86 HTTP/HMAC (dobles explicitos, no evidencia durable)', () => {
  let app: INestApplication
  const port = { find: jest.fn(), grant: jest.fn() }
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config())
      .overrideProvider(TOURNAMENT_PRIZES)
      .useValue(port)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient([qaHero, qaEpic]))
      .compile()
    await moduleRef.get(INVENTORY_REPOSITORY).save(
      Inventory.restore({
        ownerId: PlayerId.create(qaCommand().playerId),
        capacity: 200,
        slots: [{ itemId: QA_HERO_ID, quantity: 1 }],
      }),
    )
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })
  beforeEach(() => {
    port.find.mockReset().mockResolvedValue(null)
    port.grant
      .mockReset()
      .mockImplementation((c) =>
        Promise.resolve({ ...c, status: 'DELIVERED', receiptId: 'qa-receipt' }),
      )
  })
  afterAll(async () => {
    await app.close()
  })
  const send = (
    body: unknown,
    service = 'tournament',
    secret = SECRET,
    path = PATH,
    timestamp = String(Date.now()),
  ) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body as object)

  it('Tournament obtiene el eco exacto y un receiptId', async () => {
    const r = await send(qaCommand())
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ...qaCommand(), status: 'DELIVERED', receiptId: 'qa-receipt' })
  })
  it.each(['combat', 'missions', 'commerce', 'notifications', 'auction', 'web'])(
    'deniega %s incluso con HMAC valido',
    async (caller) => {
      const r = await send(qaCommand(), caller)
      expect(r.status).toBe(401)
      expect(r.body).toEqual({
        statusCode: 401,
        code: 'INTERNAL_UNAUTHORIZED',
        message: 'Peticion interna no autorizada.',
      })
      expect(port.find).not.toHaveBeenCalled()
    },
  )
  it('deniega firma invalida, caducada y JWT sin HMAC', async () => {
    expect((await send(qaCommand(), 'tournament', 'wrong')).status).toBe(401)
    expect((await send(qaCommand(), 'tournament', SECRET, PATH, '1')).status).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .post(PATH)
          .set('Authorization', 'Bearer public')
          .send(qaCommand())
      ).status,
    ).toBe(401)
  })
  it.each(['purpose', 'actor', 'receiptId', 'authorization', 'status'])(
    'rechaza %s aun firmado',
    async (field) => {
      const r = await send({ ...qaCommand(), [field]: 'injected' })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('SCHEMA_INVALID')
      expect(port.find).not.toHaveBeenCalled()
    },
  )
  it('el permiso nuevo no da acceso a grants/experiencia/compromisos existentes', async () => {
    for (const path of [
      '/api/internal/v1/inventory/grants',
      '/api/internal/v1/players/p/heroes/h/experience',
    ]) {
      expect((await send({}, 'tournament', SECRET, path)).status).toBe(401)
    }
  })
  it.each([
    ['OPERATION_ID_REUSED', 409],
    ['PRIZE_INVALID', 422],
    ['PRIZE_DEPENDENCY_UNAVAILABLE', 503],
  ] as const)('traduce %s sin filtrar infraestructura', async (code, status) => {
    port.find.mockRejectedValueOnce(new TournamentPrizeError(code, status, 'diagnostico QA'))
    const r = await send(qaCommand())
    expect(r.status).toBe(status)
    expect(r.body).toEqual({ statusCode: status, code, message: 'diagnostico QA' })
  })
  it('documenta un DTO cerrado y recibo en OpenAPI', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('QA').setVersion('1').build(),
    )
    const operation = doc.paths[PATH]?.post
    expect(operation?.security).toEqual([{ 'internal-hmac': [] }])
    expect(operation?.responses).toHaveProperty('409')
    expect(operation?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: expect.arrayContaining(Object.keys(qaCommand())),
          },
        },
      },
    })
  })
  it('modo memory y secreto ausente fallan cerrado con 503', async () => {
    for (const secret of [SECRET, '']) {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(APP_CONFIG)
        .useValue(config(secret))
        .compile()
      const other = moduleRef.createNestApplication()
      other.setGlobalPrefix('api')
      await other.init()
      try {
        const body = qaCommand()
        const timestamp = String(Date.now())
        const r = await request(other.getHttpServer())
          .post(PATH)
          .set('x-internal-service', 'tournament')
          .set('x-internal-timestamp', timestamp)
          .set(
            'x-internal-signature',
            signInternalRequest(SECRET, {
              service: 'tournament',
              method: 'POST',
              path: PATH,
              timestamp,
              body,
            }),
          )
          .send(body)
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('PRIZE_DEPENDENCY_UNAVAILABLE')
      } finally {
        await other.close()
      }
    }
  })
})
