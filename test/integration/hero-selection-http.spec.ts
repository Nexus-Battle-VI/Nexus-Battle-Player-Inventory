import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'

/**
 * HU-07 sobre HTTP con autenticacion activa y un doble sembrado de Catalog.
 *
 * El testimonio de prueba se toma como sujeto: cada prueba usa su propio
 * inventario y su propia seleccion, que es justo lo que permite comprobar el
 * aislamiento entre jugadores sobre la ruta real.
 */
const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const hero = (
  sku: string,
  subtype: string,
  name: string,
  lifecycleStatus = 'ACTIVE',
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: name,
  type: 'HEROE',
  lifecycleStatus,
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: subtype,
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'DICE', count: 1, sides: 4 },
      abilities: [`hab-${sku}`],
    },
  },
})

const espada: CatalogProductView = {
  productId: 'pid-espada-de-fuego',
  sku: 'espada-de-fuego',
  name: 'Espada de fuego',
  imageUrl: 'https://assets.example.test/espada.png',
  description: 'Espada',
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'ARMA',
      compatibilityScope: 'ALL_HEROES',
      effects: [
        {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'ATTACK',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount: 3 },
        },
      ],
    },
  },
}

const CATALOG: CatalogProductView[] = [
  hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
  hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego'),
  hero('chaman', 'CHAMAN', 'Chaman'),
  hero('heroe-retirado', 'MEDICO', 'Heroe retirado', 'SUSPENDED'),
  {
    productId: 'pid-hab-guerrero-tanque',
    sku: 'hab-guerrero-tanque',
    name: 'Golpe con escudo',
    imageUrl: '',
    description: 'Habilidad',
    type: 'HABILIDAD',
    lifecycleStatus: 'ACTIVE',
    creditsPrice: 0,
    premium: false,
    realMoneyPrice: null,
    attributes: {
      schemaVersion: '1',
      values: {
        kind: 'HABILIDAD',
        compatibleHeroSubtypes: [],
        powerCostMode: 'FIXED',
        powerCost: 2,
        chargeTurns: 1,
        effects: [],
      },
    },
  },
  espada,
]

describe('HU-07 — seleccion y equipamiento inicial del heroe (HTTP)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }
    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient(CATALOG))
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`

  const own = async (subject: string, itemId: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/api/inventories/${subject}/items`)
      .set('Authorization', bearer(subject))
      .send({ itemId, quantity: 1 })
    expect(response.status).toBe(200)
  }

  const select = (subject: string, heroReference: string) =>
    request(app.getHttpServer())
      .put('/api/inventories/me/heroes/selection')
      .set('Authorization', bearer(subject))
      .send({ heroReference })

  describe('catalogo de heroes disponibles', () => {
    it('devuelve los heroes del jugador con sus estadisticas base y habilidades', async () => {
      const jugador = 'hu07-catalogo'
      await own(jugador, 'guerrero-tanque')
      await own(jugador, 'espada-de-fuego')

      const response = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes')
        .set('Authorization', bearer(jugador))

      expect(response.status).toBe(200)
      expect(response.body).toHaveLength(1)
      expect(response.body[0]).toMatchObject({
        reference: 'guerrero-tanque',
        subtype: 'GUERRERO_TANQUE',
        lifecycleStatus: 'ACTIVE',
        selected: false,
        baseStats: { power: 5, health: 40, defense: 8, attack: 10 },
        abilities: [{ reference: 'hab-guerrero-tanque', name: 'Golpe con escudo' }],
      })
    })

    it('sin testimonio responde 401', async () => {
      const response = await request(app.getHttpServer()).get('/api/inventories/me/heroes')

      expect(response.status).toBe(401)
    })
  })

  describe('preparar un heroe', () => {
    it('prepara el heroe propio y devuelve la configuracion completa', async () => {
      const jugador = 'hu07-preparar'
      await own(jugador, 'guerrero-tanque')

      const response = await select(jugador, 'guerrero-tanque')

      expect(response.status).toBe(200)
      expect(response.body.configuration.hero.subtype).toBe('GUERRERO_TANQUE')
      expect(response.body.readiness).toEqual({ ready: true, blockers: [] })
      expect(response.body.capacity.armor).toEqual({ used: 0, max: 6 })
      expect(typeof response.body.selectedAt).toBe('string')
    })

    it('un heroe que el jugador no posee responde 404', async () => {
      const jugador = 'hu07-ajeno'
      await own(jugador, 'guerrero-tanque')

      const response = await select(jugador, 'mago-fuego')

      expect(response.status).toBe(404)
    })

    it('un heroe suspendido en el catalogo responde 409, no 404', async () => {
      const jugador = 'hu07-suspendido'
      await own(jugador, 'heroe-retirado')

      const response = await select(jugador, 'heroe-retirado')

      expect(response.status).toBe(409)
    })

    it('un cuerpo sin la referencia responde 400', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer('hu07-cuerpo'))
        .send({})

      expect(response.status).toBe(400)
    })

    /**
     * CONTROL DE AISLAMIENTO. La ruta no acepta `ownerId` en ninguna parte: si
     * alguien lo cuela en el cuerpo, la peticion se rechaza en vez de
     * interpretarlo. Sin esta prueba, anadir el campo al DTO en el futuro
     * pasaria inadvertido.
     */
    it('un ownerId en el cuerpo se rechaza en lugar de obedecerse', async () => {
      const jugador = 'hu07-suplantacion'
      await own(jugador, 'guerrero-tanque')

      const response = await request(app.getHttpServer())
        .put('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer(jugador))
        .send({ heroReference: 'guerrero-tanque', ownerId: 'otra-persona' })

      expect(response.status).toBe(400)
    })
  })

  describe('configuracion preparada', () => {
    it('sin heroe preparado responde 404', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer('hu07-sin-preparar'))

      expect(response.status).toBe(404)
    })

    /**
     * CA-08 de punta a punta: se equipa por la ruta de HU-28 y la vista de
     * HU-07 refleja la estadistica efectiva nueva. Si HU-07 mantuviera su
     * propia copia de las estadisticas, este caso fallaria.
     */
    it('refleja las estadisticas efectivas despues de equipar por la ruta de HU-28', async () => {
      const jugador = 'hu07-efectivas'
      await own(jugador, 'guerrero-tanque')
      await own(jugador, 'espada-de-fuego')
      expect((await select(jugador, 'guerrero-tanque')).status).toBe(200)

      const equipado = await request(app.getHttpServer())
        .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
        .set('Authorization', bearer(jugador))
        .send({ productReference: 'espada-de-fuego' })
      expect(equipado.status).toBe(200)

      const response = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer(jugador))

      expect(response.status).toBe(200)
      expect(response.body.configuration.baseStats.attack).toBe(10)
      expect(response.body.configuration.effectiveStats.attack).toBe(13)
      expect(response.body.capacity.weapons).toEqual({ used: 1, max: 2 })
      expect(response.body.readiness.ready).toBe(true)
    })

    /**
     * Aislamiento entre jugadores sobre la ruta real: el sujeto sale del
     * testimonio y no hay identificador manipulable. Cada uno ve el suyo.
     */
    it('cada jugador ve su propia configuracion', async () => {
      await own('hu07-aisla-a', 'guerrero-tanque')
      await own('hu07-aisla-b', 'chaman')
      expect((await select('hu07-aisla-a', 'guerrero-tanque')).status).toBe(200)
      expect((await select('hu07-aisla-b', 'chaman')).status).toBe(200)

      const a = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer('hu07-aisla-a'))
      const b = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer('hu07-aisla-b'))

      expect(a.body.configuration.hero.subtype).toBe('GUERRERO_TANQUE')
      expect(b.body.configuration.hero.subtype).toBe('CHAMAN')
    })

    it('cambiar de heroe sustituye la seleccion, no la duplica', async () => {
      const jugador = 'hu07-cambio'
      await own(jugador, 'guerrero-tanque')
      await own(jugador, 'mago-fuego')

      expect((await select(jugador, 'guerrero-tanque')).status).toBe(200)
      expect((await select(jugador, 'mago-fuego')).status).toBe(200)

      const response = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes/selection')
        .set('Authorization', bearer(jugador))
      const heroes = await request(app.getHttpServer())
        .get('/api/inventories/me/heroes')
        .set('Authorization', bearer(jugador))

      expect(response.body.configuration.hero.subtype).toBe('MAGO_FUEGO')
      expect(heroes.body.filter((entry: { selected: boolean }) => entry.selected)).toHaveLength(1)
    })
  })
})
