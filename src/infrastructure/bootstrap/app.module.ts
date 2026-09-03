import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

import { InventoriesController } from '../../adapters/inbound/http/inventories.controller'
import { InventoryGrantsController } from '../../adapters/inbound/http/inventory-grants.controller'
import { InternalServiceGuard } from '../../adapters/inbound/http/auth/internal-service.guard'
import {
  INVENTORY_GRANTS,
  type InventoryGrantPort,
} from '../../application/ports/InventoryGrantPort'
import {
  GRANT_PURCHASED_ITEMS,
  GrantPurchasedItems,
} from '../../application/use-cases/GrantPurchasedItems'
import { MyInventoryController } from '../../adapters/inbound/http/my-inventory.controller'
import { HeroEquipmentController } from '../../adapters/inbound/http/hero-equipment.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import {
  ADD_ITEM,
  EQUIP_ITEM_ON_HERO,
  GET_HERO_EQUIPMENT,
  GET_INVENTORY,
  GET_ITEM_DETAIL,
  LIST_OWNED_ITEMS,
  REMOVE_ITEM,
} from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import {
  AddItemToInventory,
  GetInventory,
  RemoveItemFromInventory,
} from '../../application/use-cases/InventoryUseCases'
import { ListOwnedInventoryItems } from '../../application/use-cases/ListOwnedInventoryItems'
import { GetOwnedInventoryItemDetail } from '../../application/use-cases/GetOwnedInventoryItemDetail'
import { GetHeroEquipment } from '../../application/use-cases/GetHeroEquipment'
import { EquipItemOnHero } from '../../application/use-cases/EquipItemOnHero'
import { INVENTORY_REPOSITORY } from '../../application/ports/InventoryRepositoryPort'
import { INVENTORY_QUERY } from '../../application/ports/InventoryQueryPort'
import { CATALOG_READ } from '../../application/ports/CatalogReadPort'
import { HERO_LOADOUT_REPOSITORY } from '../../application/ports/HeroLoadoutRepositoryPort'
import { CLOCK } from '../../application/ports/ClockPort'
import type { InventoryRepositoryPort } from '../../application/ports/InventoryRepositoryPort'
import type { InventoryQueryPort } from '../../application/ports/InventoryQueryPort'
import type { CatalogReadPort } from '../../application/ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../../application/ports/HeroLoadoutRepositoryPort'
import type { ClockPort } from '../../application/ports/ClockPort'

import { InMemoryInventoryRepository } from '../../adapters/outbound/persistence/InMemoryInventoryRepository'
import { MongoInventoryRepository } from '../../adapters/outbound/persistence/MongoInventoryRepository'
import { InMemoryHeroLoadoutRepository } from '../../adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { MongoHeroLoadoutRepository } from '../../adapters/outbound/persistence/MongoHeroLoadoutRepository'
import { HttpCatalogReadClient } from '../../adapters/outbound/catalog/HttpCatalogReadClient'
import { InMemoryCatalogReadClient } from '../../adapters/outbound/catalog/InMemoryCatalogReadClient'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { CapacityPolicy } from '../../domain/policies/CapacityPolicy'

import type { Db } from 'mongodb'

import { createMongoClient, databaseOf } from '../persistence/database'
import { createLogger, type Logger } from '../observability/logger'
import { AuthMode, loadConfig, PersistenceDriver, type AppConfig } from '../config/env'

import { JwtAuthGuard } from '../../adapters/inbound/http/auth/jwt-auth.guard'
import { RolesGuard } from '../../adapters/inbound/http/auth/roles.guard'
import { AnonymousIdentityGuard } from '../../adapters/inbound/http/auth/anonymous.guard'
import { TOKEN_VERIFIER } from '../../application/ports/TokenVerifierPort'
import type { TokenVerifierPort } from '../../application/ports/TokenVerifierPort'
import { CognitoTokenVerifier } from '../../adapters/outbound/identity/CognitoTokenVerifier'
import type { ReadinessCheck, VersionReport } from '../health/health'

export const APP_CONFIG = Symbol('AppConfig')
export const LOGGER = Symbol('Logger')
export const CAPACITY_POLICY = Symbol('CapacityPolicy')
/**
 * Conexion a MongoDB compartida por los repositorios (inventario y loadout de
 * heroe). Un solo cliente y un solo pool: ADR-011 desaconseja que un servicio
 * abra varios. Es `null` con `PERSISTENCE_DRIVER=memory`.
 */
export const MONGO_DATABASE = Symbol('MongoDatabase')
export const MONGO_LIFECYCLE = Symbol('MongoLifecycle')

/**
 * Raiz de composicion.
 *
 * Es el unico lugar donde se eligen implementaciones concretas. Los casos de
 * uso son clases planas sin decoradores de NestJS: se registran con fabricas
 * explicitas, de modo que la capa de aplicacion permanece independiente del
 * framework y podria ejecutarse fuera de el sin cambios.
 */
@Module({
  controllers: [
    InventoriesController,
    MyInventoryController,
    HeroEquipmentController,
    HealthController,
    InventoryGrantsController,
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
    {
      provide: LOGGER,
      useFactory: (config: AppConfig): Logger =>
        createLogger({
          level: config.logLevel,
          service: config.serviceName,
          version: config.version,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: MONGO_DATABASE,
      useFactory: async (config: AppConfig, logger: Logger): Promise<Db | null> => {
        if (config.persistenceDriver !== PersistenceDriver.Mongo) {
          logger.warn('in_memory_persistence', {
            detail: 'PERSISTENCE_DRIVER=memory: el estado se pierde al reiniciar el servicio.',
          })

          return null
        }

        // `loadConfig` ya garantiza que MONGODB_URI existe con este driver: un
        // servicio mal configurado no debe arrancar y aparentar salud.
        if (config.databaseUrl === null) {
          throw new Error('MONGODB_URI es obligatorio con PERSISTENCE_DRIVER=mongo.')
        }

        const options = { uri: config.databaseUrl }
        const client = createMongoClient(options)

        // Se conecta AQUI, y no de forma perezosa en la primera consulta. El
        // driver permite lo segundo, pero entonces un motor inalcanzable se
        // manifestaria como un error de peticion en vez de como lo que es: un
        // servicio que no deberia haber arrancado.
        await client.connect()

        logger.info('mongo_persistence', { detail: 'Adaptador MongoDB activo.' })

        // El esquema NO se migra aqui. Migrar al arrancar hace que varias
        // replicas migren a la vez y que una migracion rota deje el servicio en
        // bucle de reinicio. Es un paso explicito: `npm run migrate`.
        return databaseOf(client, options)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: MONGO_LIFECYCLE,
      useFactory: (db: Db | null): { onModuleDestroy: () => Promise<void> } => ({
        onModuleDestroy: async (): Promise<void> => {
          await db?.client.close()
        },
      }),
      inject: [MONGO_DATABASE],
    },
    {
      provide: INVENTORY_REPOSITORY,
      useFactory: (db: Db | null): InventoryRepositoryPort =>
        db === null ? new InMemoryInventoryRepository() : new MongoInventoryRepository(db),
      inject: [MONGO_DATABASE],
    },
    {
      provide: HERO_LOADOUT_REPOSITORY,
      useFactory: (db: Db | null): HeroLoadoutRepositoryPort =>
        db === null ? new InMemoryHeroLoadoutRepository() : new MongoHeroLoadoutRepository(db),
      inject: [MONGO_DATABASE],
    },
    {
      provide: TOKEN_VERIFIER,
      useFactory: (config: AppConfig, logger: Logger): TokenVerifierPort => {
        if (config.cognito === null) {
          // No se devuelve un verificador que acepte cualquier cosa: sin
          // proveedor, el guard directamente no se registra. Un verificador
          // permisivo daria la apariencia de que hay comprobacion.
          logger.warn('authentication_disabled', {
            detail:
              'AUTH_MODE=disabled: ninguna ruta verifica quien realiza la peticion. BLOCKER de ADR-004.',
          })

          return {
            verify: (): Promise<never> => {
              throw new Error('No hay verificador de testimonios configurado.')
            },
          }
        }

        return new CognitoTokenVerifier(config.cognito)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    // Los guards se registran de forma global SOLO cuando hay proveedor. El
    // orden importa: JwtAuthGuard deja la identidad verificada en la peticion y
    // RolesGuard la lee. NestJS los ejecuta en el orden de declaracion.
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        verifier: TokenVerifierPort,
      ): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new JwtAuthGuard(reflector, verifier)
          : // Sin proveedor no se deja pasar sin mas: se atribuye la identidad
            // anonima, para que lo que se guarde diga que nadie fue verificado.
            new AnonymousIdentityGuard(),
      inject: [APP_CONFIG, Reflector, TOKEN_VERIFIER],
    },
    {
      provide: APP_GUARD,
      useFactory: (config: AppConfig, reflector: Reflector): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new RolesGuard(reflector)
          : { canActivate: (): boolean => true },
      inject: [APP_CONFIG, Reflector],
    },
    {
      provide: CLOCK,
      useFactory: (): ClockPort => new SystemClock(),
    },
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        clock: ClockPort,
        logger: Logger,
      ): CanActivate =>
        new InternalServiceGuard({
          reflector,
          secret: config.internalServiceAuthSecret,
          allowedServices: ['commerce'],
          clock,
          logger,
        }),
      inject: [APP_CONFIG, Reflector, CLOCK, LOGGER],
    },
    { provide: INVENTORY_GRANTS, useExisting: INVENTORY_REPOSITORY },
    {
      provide: GRANT_PURCHASED_ITEMS,
      useFactory: (grants: InventoryGrantPort): GrantPurchasedItems =>
        new GrantPurchasedItems(grants),
      inject: [INVENTORY_GRANTS],
    },
    {
      provide: CAPACITY_POLICY,
      useFactory: (): CapacityPolicy => CapacityPolicy.default(),
    },
    {
      provide: GET_INVENTORY,
      useFactory: (inventories: InventoryRepositoryPort): GetInventory =>
        new GetInventory(inventories),
      inject: [INVENTORY_REPOSITORY],
    },
    // La consulta de HU-27 usa un puerto de LECTURA propio (CQRS ligero). Lo
    // sirve el mismo adaptador de persistencia que ya elige el driver: la
    // separacion es de responsabilidad, no de origen de datos.
    {
      provide: INVENTORY_QUERY,
      useExisting: INVENTORY_REPOSITORY,
    },
    // Cliente de LECTURA de Catalog. Con `CATALOG_BASE_URL` informado usa el
    // adaptador HTTP real; sin el, un doble que siempre responde "no disponible"
    // — la busqueda y la ficha responderan 503 en vez de inventar datos.
    {
      provide: CATALOG_READ,
      useFactory: (config: AppConfig, logger: Logger): CatalogReadPort => {
        if (config.catalog === null) {
          logger.warn('catalog_read_disabled', {
            detail:
              'CATALOG_BASE_URL sin configurar: la busqueda por nombre y la ficha de detalle responderan 503.',
          })

          return new InMemoryCatalogReadClient([], true)
        }

        logger.info('catalog_read_http', { baseUrl: config.catalog.baseUrl })

        return new HttpCatalogReadClient({
          baseUrl: config.catalog.baseUrl,
          timeoutMs: config.catalog.timeoutMs,
        })
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: LIST_OWNED_ITEMS,
      useFactory: (
        inventories: InventoryQueryPort,
        catalog: CatalogReadPort,
      ): ListOwnedInventoryItems => new ListOwnedInventoryItems(inventories, catalog),
      inject: [INVENTORY_QUERY, CATALOG_READ],
    },
    {
      provide: GET_ITEM_DETAIL,
      useFactory: (
        inventories: InventoryQueryPort,
        catalog: CatalogReadPort,
      ): GetOwnedInventoryItemDetail => new GetOwnedInventoryItemDetail(inventories, catalog),
      inject: [INVENTORY_QUERY, CATALOG_READ],
    },
    {
      provide: GET_HERO_EQUIPMENT,
      useFactory: (
        inventories: InventoryQueryPort,
        catalog: CatalogReadPort,
        loadouts: HeroLoadoutRepositoryPort,
      ): GetHeroEquipment => new GetHeroEquipment(inventories, catalog, loadouts),
      inject: [INVENTORY_QUERY, CATALOG_READ, HERO_LOADOUT_REPOSITORY],
    },
    {
      provide: EQUIP_ITEM_ON_HERO,
      useFactory: (
        inventories: InventoryQueryPort,
        catalog: CatalogReadPort,
        loadouts: HeroLoadoutRepositoryPort,
        clock: ClockPort,
      ): EquipItemOnHero => new EquipItemOnHero(inventories, catalog, loadouts, clock),
      inject: [INVENTORY_QUERY, CATALOG_READ, HERO_LOADOUT_REPOSITORY, CLOCK],
    },
    {
      provide: ADD_ITEM,
      useFactory: (
        inventories: InventoryRepositoryPort,
        clock: ClockPort,
        defaultCapacity: CapacityPolicy,
      ): AddItemToInventory => new AddItemToInventory({ inventories, clock, defaultCapacity }),
      inject: [INVENTORY_REPOSITORY, CLOCK, CAPACITY_POLICY],
    },
    {
      provide: REMOVE_ITEM,
      useFactory: (
        inventories: InventoryRepositoryPort,
        clock: ClockPort,
        defaultCapacity: CapacityPolicy,
      ): RemoveItemFromInventory =>
        new RemoveItemFromInventory({ inventories, clock, defaultCapacity }),
      inject: [INVENTORY_REPOSITORY, CLOCK, CAPACITY_POLICY],
    },
    {
      provide: READINESS_CHECKS,
      useFactory: (inventories: InventoryRepositoryPort): readonly ReadinessCheck[] => [
        // La comprobacion ejercita el repositorio de verdad: si el almacen no
        // responde, la sonda falla. No se declara `ok` de forma incondicional.
        {
          name: 'inventories-repository',
          check: (): boolean => typeof inventories.findByOwner === 'function',
        },
      ],
      inject: [INVENTORY_REPOSITORY],
    },
    {
      provide: VERSION_REPORT,
      useFactory: (config: AppConfig): VersionReport => ({
        service: config.serviceName,
        version: config.version,
        nodeEnv: config.nodeEnv,
      }),
      inject: [APP_CONFIG],
    },
  ],
})
export class AppModule {}
