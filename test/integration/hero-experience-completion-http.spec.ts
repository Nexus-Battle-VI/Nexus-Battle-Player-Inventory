import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'

/**
 * Contrato HTTP interno de la XP de FINALIZACION (HU-10, Task HU-10.2;
 * `hu-10-mission-completion-reward-v1` §8): `MISSION_COMPLETION` sobre la MISMA
 * ruta de experiencia que HU-09.
 *
 * Se comprueba la union discriminada de punta a punta (una variante no admite los
 * campos de la otra), la idempotencia, los codigos y la frontera interna: HMAC,
 * lista de servicios por ruta y fallo cerrado. La ruta NO es publica.
 */
const SECRET = 'secreto-de-pruebas'
const PLAYER_ID = 'sub-jugador-completion'
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const PATH = `/api/internal/v1/players/${PLAYER_ID}/heroes/${HERO_ID}/experience`
const ENROLLMENT_ID = 'enr_01JB8Y3K7Q'
const OPERATION_ID = `mission:${ENROLLMENT_ID}:reward:completion:xp`

const completionBody = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  amount: 40,
  source: {
    kind: 'MISSION_COMPLETION',
    enrollmentId: ENROLLMENT_ID,
    missionId: 'msn_templo_olvidado',
    simulationId: 'sim_01JB8Y4B',
    difficulty: 'NORMAL',
    missionOutcome: 'COMPLETED',
  },
  ...overrides,
})

const rivalBody = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  operationId: 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
  amount: 10,
  source: {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: ENROLLMENT_ID,
    simulationId: 'sim_01JB8Y4B',
    encounterId: '5',
    enemyInstanceId: 'guardian-eterno#1',
    rivalRef: 'guardian-eterno',
    roll: 5,
  },
  ...overrides,
})

const sourceOf = (body: { source: object }) => body.source

describe('POST /api/internal/v1/players/:playerId/heroes/:heroId/experience — MISSION_COMPLETION', () => {
  let app: INestApplication

  const boot = async (secret: string | undefined): Promise<INestApplication> => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'jwt',
          COGNITO_USER_POOL_ID: 'us-east-1_test',
          COGNITO_CLIENT_ID: 'test',
          ...(secret === undefined ? {} : { INTERNAL_SERVICE_AUTH_SECRET: secret }),
        }),
      )
      .compile()
    const instance = module.createNestApplication()

    instance.setGlobalPrefix('api')
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await instance.init()

    return instance
  }

  beforeAll(async () => {
    app = await boot(SECRET)
  })

  afterAll(async () => {
    await app.close()
  })

  const post = (
    body: object,
    service = 'missions',
    timestamp = String(Date.now()),
    signature?: string,
    path = PATH,
    target: INestApplication = app,
  ) =>
    request(target.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signature ??
          signInternalRequest(SECRET, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body)

  it('acredita la XP de finalizacion y devuelve la progresion de HU-08', async () => {
    const response = await post(completionBody({ amount: 40 }))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      operationId: OPERATION_ID,
      applied: true,
      heroId: HERO_ID,
      level: 1,
      currentXp: 40,
      leveledUp: false,
      levelsGained: 0,
      nextLevel: { status: 'AVAILABLE', forNextLevel: 2, amount: 100 },
      maxLevel: 8,
    })
  })

  it('el replay con el MISMO cuerpo responde 200 applied:false y NO acredita otra vez', async () => {
    const replay = await post(completionBody({ amount: 40 }))

    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ applied: false, currentXp: 40, level: 1 })
  })

  it.each([
    ['otro importe', { amount: 999 }],
    ['otra dificultad', { source: { ...sourceOf(completionBody()), difficulty: 'HEROIC' } }],
    ['otro desenlace', { source: { ...sourceOf(completionBody()), missionOutcome: 'FAILED' } }],
  ])(
    'el mismo operationId con %s responde 409 EXPERIENCE_GRANT_CONFLICT',
    async (_label, changed) => {
      const response = await post(completionBody(changed))

      expect(response.status).toBe(409)
      expect(response.body.code).toBe('EXPERIENCE_GRANT_CONFLICT')

      // Y no sobrescribio nada.
      expect((await post(completionBody({ amount: 40 }))).body).toMatchObject({
        applied: false,
        currentXp: 40,
      })
    },
  )

  it('HU-09 sigue funcionando sobre la misma ruta y suma a la misma progresion', async () => {
    const response = await post(rivalBody({ amount: 10 }))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ applied: true, currentXp: 50 })
  })

  it('una finalizacion con campos de derrota responde 400 SCHEMA_INVALID', async () => {
    const response = await post(
      completionBody({
        operationId: OPERATION_ID,
        source: { ...sourceOf(completionBody()), roll: 7, enemyInstanceId: 'x#1' },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it('una derrota con campos de finalizacion responde 400 SCHEMA_INVALID', async () => {
    const response = await post(
      rivalBody({
        operationId: 'op-mezcla',
        source: { ...sourceOf(rivalBody()), missionId: 'msn_x', difficulty: 'NORMAL' },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it.each([
    ['un kind desconocido', { source: { ...sourceOf(completionBody()), kind: 'MISSION_BONUS' } }],
    [
      'un desenlace VOIDED',
      { source: { ...sourceOf(completionBody()), missionOutcome: 'VOIDED' } },
    ],
    [
      'una dificultad fuera del vocabulario',
      { source: { ...sourceOf(completionBody()), difficulty: 'EASY' } },
    ],
    ['un operationId de otra matricula', { operationId: 'mission:otra:reward:completion:xp' }],
  ])('%s responde 400 SCHEMA_INVALID', async (_label, overrides) => {
    const response = await post(completionBody(overrides))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it('una schemaVersion distinta responde 400 SCHEMA_INVALID', async () => {
    const response = await post(completionBody({ schemaVersion: 2 }))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('SCHEMA_INVALID')
  })

  it('un cuerpo mal formado (source no es un objeto) responde 400', async () => {
    const response = await post(completionBody({ source: 'MISSION_COMPLETION' }))

    expect(response.status).toBe(400)
  })

  it('un campo de mas fuera del origen responde 400', async () => {
    const response = await post(completionBody({ xpForDifficulty: 999 }))

    expect(response.status).toBe(400)
  })

  it.each([25.5, -5])('un importe no entero o negativo responde 422: %s', async (amount) => {
    const response = await post(
      completionBody({
        amount,
        operationId: 'mission:enr_otra:reward:completion:xp',
        source: { ...sourceOf(completionBody()), enrollmentId: 'enr_otra' },
      }),
    )

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('EXPERIENCE_GRANT_REJECTED')
  })

  describe('frontera interna', () => {
    it('sin firma interna responde 401 y no acredita nada', async () => {
      const response = await request(app.getHttpServer()).post(PATH).send(completionBody())

      expect(response.status).toBe(401)
    })

    it('una firma que no corresponde al cuerpo responde 401', async () => {
      const timestamp = String(Date.now())
      const signature = signInternalRequest(SECRET, {
        service: 'missions',
        method: 'POST',
        path: PATH,
        timestamp,
        body: completionBody({ amount: 1 }),
      })

      expect(
        (await post(completionBody({ amount: 2 }), 'missions', timestamp, signature)).status,
      ).toBe(401)
    })

    it('un sello fuera de la ventana responde 401', async () => {
      const old = String(Date.now() - 10 * 60_000)

      expect((await post(completionBody(), 'missions', old)).status).toBe(401)
    })

    it.each(['commerce', 'notifications', 'combat', 'web', 'auction'])(
      'un servicio que no es missions responde 401 en esta ruta: %s',
      async (service) => {
        expect((await post(completionBody(), service)).status).toBe(401)
      },
    )

    it('sin secreto configurado el contrato interno NIEGA (falla cerrado)', async () => {
      const closed = await boot(undefined)

      try {
        const response = await request(closed.getHttpServer())
          .post(PATH)
          .set('x-internal-service', 'missions')
          .set('x-internal-timestamp', String(Date.now()))
          .set('x-internal-signature', 'cualquiera')
          .send(completionBody({ operationId: 'mission:enr_cerrada:reward:completion:xp' }))

        expect(response.status).toBe(503)
        expect(response.body.currentXp).toBeUndefined()
      } finally {
        await closed.close()
      }
    })

    it('un cliente con testimonio de jugador (Web) no puede invocarla', async () => {
      const response = await request(app.getHttpServer())
        .post(PATH)
        .set('authorization', 'Bearer token-de-jugador')
        .send(completionBody())

      expect(response.status).toBe(401)
    })
  })
})
