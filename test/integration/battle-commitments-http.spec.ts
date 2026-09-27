import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
} from '../../src/application/ports/TokenVerifierPort'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'

/**
 * Compromiso interno de BATTLE del heroe (HU-29, Task HU-29.2,
 * `hu-29-battle-commitment-v1` §3).
 *
 * Es la ruta que hace REAL el bloqueo: sin ella, el guard de equipamiento existe
 * y nunca se dispara. Aqui se prueba la frontera HTTP completa, con la firma
 * interna de verdad y los dos permisos: `combat` si, `missions` no.
 */
const SECRET = 'battle-test-secret'
const HERO_ID = 'pid-guerrero-tanque'
const PLAYER = 'jugador-battle'
const PATH = `/api/internal/v1/inventory/heroes/${HERO_ID}/battle-commitments`
const RELEASE = (operationId: string) =>
  `/api/internal/v1/inventory/battle-commitments/${operationId}/release`

const hero: CatalogProductView = {
  productId: HERO_ID,
  sku: 'guerrero-tanque',
  name: 'Guerrero Tanque',
  imageUrl: '',
  description: '',
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: 'GUERRERO_TANQUE',
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'FIXED', amount: 4 },
      abilities: [],
    },
  },
}

const verifier: TokenVerifierPort = {
  verify: (token) =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const input = (operationId: string, overrides: Record<string, unknown> = {}) => ({
  operationId,
  playerId: PLAYER,
  reference: 'room_prueba_1',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  ...overrides,
})

describe('Compromiso interno BATTLE del heroe', () => {
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
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient([hero]))
      .compile()

    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    for (const itemId of ['guerrero-tanque']) {
      await request(app.getHttpServer())
        .post(`/api/inventories/${PLAYER}/items`)
        .set('Authorization', `Bearer ${PLAYER}`)
        .send({ itemId, quantity: 1 })
        .expect(200)
    }
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * Firma como firma el guard: `x-internal-signature` sobre el cuerpo que viaja.
   * Para una peticion sin cuerpo, el guard verifica con `request.body ?? {}`, asi
   * que la liberacion se firma y se envia con `{}` —no con `null`—, que es lo
   * mismo que hace el cliente real de Missions.
   */
  const signed = (path: string, body: object | undefined, service = 'combat') => {
    const timestamp = String(Date.now())
    const payload = body ?? {}

    return request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(SECRET, {
          service,
          method: 'POST',
          path,
          timestamp,
          body: payload,
        }),
      )
      .send(payload)
  }

  it('niega llamadas sin firma o desde un servicio no autorizado', async () => {
    const body = input('11111111-1111-4111-8111-111111111111')

    await request(app.getHttpServer()).post(PATH).send(body).expect(401)
    // `missions` tiene su PROPIA ruta de compromiso: no se le abre esta.
    await signed(PATH, body, 'missions').expect(401)
    await signed(PATH, body, 'commerce').expect(401)
  })

  it('compromete al heroe y responde con la forma del contrato', async () => {
    const operationId = 'aaaaaaaa-1111-4111-8111-111111111111'
    const response = await signed(PATH, input(operationId))

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      heroId: HERO_ID,
      purpose: 'BATTLE',
      reference: 'room_prueba_1',
    })
    expect(response.body.commitmentId).toBe(`cmt_${operationId}`)

    await signed(RELEASE(operationId), undefined).expect(204)
  })

  it('repetir la misma operacion es idempotente y devuelve el mismo compromiso', async () => {
    const operationId = 'bbbbbbbb-1111-4111-8111-111111111111'
    const body = input(operationId)
    const first = await signed(PATH, body)
    const second = await signed(PATH, body)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)

    await signed(RELEASE(operationId), undefined).expect(204)
  })

  it('la misma clave con otro contenido es 409 y no sobrescribe', async () => {
    const operationId = 'cccccccc-1111-4111-8111-111111111111'
    await signed(PATH, input(operationId)).expect(201)

    const conflict = await signed(PATH, input(operationId, { reference: 'room_otra' }))

    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe('OPERATION_ID_REUSED')

    await signed(RELEASE(operationId), undefined).expect(204)
  })

  it('rechaza un heroe ajeno con 422 y no crea compromiso', async () => {
    const response = await signed(
      PATH,
      input('dddddddd-1111-4111-8111-111111111111', { playerId: 'otro-jugador' }),
    )

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('HERO_NOT_OWNED')
  })

  it('rechaza una caducidad que no es futura', async () => {
    const response = await signed(
      PATH,
      input('eeeeeeee-1111-4111-8111-111111111111', {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    )

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('INVALID_EXPIRY')
  })

  it('rechaza un operationId que no es UUID antes de tocar nada', async () => {
    const response = await signed(PATH, input('no-es-un-uuid'))

    expect(response.status).toBe(400)
  })

  it('un identificador de jugador en blanco es 400, no 500', async () => {
    // Pasa la validacion del DTO (longitud 1) y lo rechaza el dominio: el
    // controlador tiene que traducir ese error, no dejarlo escapar.
    const response = await signed(
      PATH,
      input('ffffffff-1111-4111-8111-111111111111', { playerId: ' ' }),
    )

    expect(response.status).toBe(400)
  })

  it('un heroe no puede estar en dos batallas activas a la vez', async () => {
    const first = 'f1570000-1111-4111-8111-111111111111'
    const second = '5ec0d000-1111-4111-8111-111111111111'

    await signed(PATH, input(first)).expect(201)

    const busy = await signed(PATH, input(second))

    expect(busy.status).toBe(422)
    expect(busy.body.code).toBe('HERO_COMMITTED')

    await signed(RELEASE(first), undefined).expect(204)
  })

  it('la liberacion es idempotente y deja volver a comprometer', async () => {
    const first = '4e1ea500-1111-4111-8111-111111111111'
    const second = '4e1ea600-1111-4111-8111-111111111111'

    await signed(PATH, input(first)).expect(201)
    await signed(RELEASE(first), undefined).expect(204)
    // Repetir la liberacion no es un error: un reintento tras un timeout es el
    // caso normal, no la excepcion.
    await signed(RELEASE(first), undefined).expect(204)
    // Y el heroe queda libre.
    await signed(PATH, input(second)).expect(201)

    await signed(RELEASE(second), undefined).expect(204)
  })

  it('un compromiso vencido deja de bloquear y no impide uno nuevo', async () => {
    const stale = '57a1e000-1111-4111-8111-111111111111'
    const fresh = 'f4e54000-1111-4111-8111-111111111111'

    // Se compromete con una caducidad futura y se deja vencer sin liberarlo: es
    // exactamente el caso de una liberacion perdida.
    await signed(PATH, input(stale, { expiresAt: new Date(Date.now() + 50).toISOString() })).expect(
      201,
    )
    await new Promise((resolve) => setTimeout(resolve, 120))

    const response = await signed(PATH, input(fresh))

    expect(response.status).toBe(201)

    await signed(RELEASE(fresh), undefined).expect(204)
  })
})
