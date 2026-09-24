import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'

/**
 * Contrato HTTP interno de la acreditacion de experiencia (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * Aqui se comprueba lo que el contrato promete y lo que la Task #441 exige del
 * permiso: la ruta responde a `missions` y NO a los servicios que si estan en la
 * lista global de Player/Inventory, que es para lo que existe
 * `@InternalCallers('missions')`.
 */
const SECRET = 'secreto-de-pruebas'
const PLAYER_ID = 'sub-jugador-1'
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const PATH = `/api/internal/v1/players/${PLAYER_ID}/heroes/${HERO_ID}/experience`
const GRANTS_PATH = '/api/internal/v1/inventory/grants'

const bodyWith = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  operationId: 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
  amount: 25,
  source: {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: 'enr_01JB8Y3K7Q',
    simulationId: 'sim_01JB8Y4B',
    encounterId: '5',
    enemyInstanceId: 'guardian-eterno#1',
    rivalRef: 'guardian-eterno',
    roll: 5,
  },
  ...overrides,
})

describe('POST /api/internal/v1/players/:playerId/heroes/:heroId/experience', () => {
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
          INTERNAL_SERVICE_AUTH_SECRET: SECRET,
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

  const post = (
    path: string,
    body: object,
    service = 'missions',
    timestamp = String(Date.now()),
    signature?: string,
  ) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signature ??
          signInternalRequest(SECRET, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body)

  it('acredita y devuelve el estado del heroe con el umbral derivado', async () => {
    const response = await post(PATH, bodyWith({ amount: 25 }))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      operationId: bodyWith().operationId,
      applied: true,
      heroId: HERO_ID,
      level: 1,
      currentXp: 25,
      leveledUp: false,
      levelsGained: 0,
      nextLevel: { status: 'AVAILABLE', forNextLevel: 2, amount: 200 },
      maxLevel: 8,
    })
  })

  it('el reintento con el MISMO cuerpo devuelve lo mismo con applied:false y no vuelve a acreditar', async () => {
    const replay = await post(PATH, bodyWith({ amount: 25 }))

    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ applied: false, level: 1, currentXp: 25 })
  })

  it('el mismo operationId con OTRO contenido responde 409 EXPERIENCE_GRANT_CONFLICT', async () => {
    const response = await post(PATH, bodyWith({ amount: 999 }))

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('EXPERIENCE_GRANT_CONFLICT')
  })

  it('el mismo operationId desde OTRA derrota (otro origen) tambien es conflicto', async () => {
    const response = await post(
      PATH,
      bodyWith({
        source: { ...bodyWith().source, enemyInstanceId: 'guardian-eterno#2' },
      }),
    )

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('EXPERIENCE_GRANT_CONFLICT')
  })

  it.each([25.5, -5, 0.1])('un importe no entero o negativo responde 422: %s', async (amount) => {
    const response = await post(
      PATH,
      bodyWith({ amount, operationId: `mission:fraccionario:${String(amount)}:xp` }),
    )

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('EXPERIENCE_GRANT_REJECTED')
  })

  it('una schemaVersion distinta responde 400 SCHEMA_INVALID', async () => {
    const response = await post(PATH, bodyWith({ schemaVersion: 2, operationId: 'op-version' }))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it('un origen sin la derrota responde 400 SCHEMA_INVALID', async () => {
    const response = await post(
      PATH,
      bodyWith({
        operationId: 'op-sin-origen',
        source: { ...bodyWith().source, enemyInstanceId: '' },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it('un campo que el contrato no declara responde 400', async () => {
    const response = await post(PATH, bodyWith({ operationId: 'op-extra', xpAmount: 999 }))

    expect(response.status).toBe(400)
  })

  it('sin firma interna responde 401 y no acredita nada', async () => {
    const response = await request(app.getHttpServer()).post(PATH).send(bodyWith())

    expect(response.status).toBe(401)
    // El heroe sigue sin experiencia: la peticion no llego a la capa de aplicacion.
    const read = await post(PATH, bodyWith())
    expect(read.body.currentXp).toBe(25)
  })

  it('una firma que no corresponde al cuerpo responde 401', async () => {
    const timestamp = String(Date.now())
    const signature = signInternalRequest(SECRET, {
      service: 'missions',
      method: 'POST',
      path: PATH,
      timestamp,
      body: bodyWith({ amount: 777 }),
    })

    expect(
      (await post(PATH, bodyWith({ amount: 888 }), 'missions', timestamp, signature)).status,
    ).toBe(401)
  })

  it.each(['commerce', 'notifications', 'combat'])(
    'un servicio de la lista GLOBAL que no es missions responde 401 en esta ruta: %s',
    async (service) => {
      expect((await post(PATH, bodyWith(), service)).status).toBe(401)
    },
  )

  it('missions NO esta en la lista global: en la ruta de grants del inventario responde 401', async () => {
    const grants = {
      operationId: '22222222-2222-4222-8222-222222222222',
      playerId: 'sub-jugador-1',
      items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
    }

    // La lista global sigue siendo la de siempre: no se amplio para que Missions
    // pudiera llamar. El permiso es por ruta.
    expect((await post(GRANTS_PATH, grants, 'missions')).status).toBe(401)
    expect((await post(GRANTS_PATH, grants, 'commerce')).status).toBe(200)
  })

  it('acumula sin restar entre dos derrotas distintas', async () => {
    // Heroe propio: los casos de arriba ya acreditaron experiencia al otro, y el
    // estado del servicio es el mismo durante toda la suite.
    const path = `/api/internal/v1/players/${PLAYER_ID}/heroes/otro-heroe/experience`
    const first = await post(path, bodyWith({ operationId: 'mission:derrota-1:xp', amount: 749 }))
    const second = await post(path, bodyWith({ operationId: 'mission:derrota-2:xp', amount: 100 }))

    expect(first.body).toMatchObject({ currentXp: 749, level: 3, applied: true })
    expect(second.body).toMatchObject({
      currentXp: 849,
      level: 4,
      leveledUp: true,
      levelsGained: 1,
      applied: true,
    })
    expect(second.body.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 5, amount: 1600 })
  })
})
