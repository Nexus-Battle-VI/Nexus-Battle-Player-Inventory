# Nexus-Battle-Player-Inventory

Servicio de jugador e inventario de Nexus Battles VI. Implementa el bounded context **Player/Inventory**: qué objetos posee un jugador y en qué cantidad.

Este repositorio contiene código y Pull Requests. No contiene Issues ni Product Backlog: la fuente única de verdad es [Nexus-Battle-Management](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management).

- **Team propietario:** Team Alfa
- **Arquitectura interna:** Clean + Hexagonal, con puertos y adaptadores
- **Base de datos objetivo:** MongoDB (ver limitaciones más abajo)
- **Documentación técnica del sistema:** [Nexus-Battle-Infrastructure](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure)

## La regla central: capacidad y apilado

Un inventario tiene una capacidad expresada en **ranuras distintas**, no en unidades totales.

```text
capacidad 2, inventario vacio

  anadir 3 pociones   -> 1 ranura ocupada, 3 unidades
  anadir 4 pociones   -> 1 ranura ocupada, 7 unidades   (apila, no consume ranura)
  anadir 1 espada     -> 2 ranuras ocupadas             (objeto nuevo, consume ranura)
  anadir 1 escudo     -> rechazado: inventario completo
  anadir 9 pociones   -> permitido aunque este completo (apila sobre ranura existente)
```

Retirar unidades hasta agotarlas **elimina la ranura**, de modo que no quedan ranuras vacías ocupando capacidad.

## Requisitos

| Herramienta | Versión                                       |
| ----------- | --------------------------------------------- |
| Node.js     | 24 LTS (`.nvmrc` fija el major 24)            |
| npm         | 11 o superior                                 |
| Docker      | opcional, para construir y ejecutar la imagen |

Este repositorio usa **npm** y `package-lock.json`. No se utilizan pnpm ni yarn.

## Puesta en marcha

```bash
nvm use
npm ci
cp .env.example .env
npm run dev
```

Con la configuración por defecto el servicio arranca con el repositorio en memoria: no requiere base de datos ni servicios externos.

Documentación interactiva de la API en `http://localhost:3002/api/docs`.

## API

| Método | Ruta                                       | Descripción                                                    |
| ------ | ------------------------------------------ | -------------------------------------------------------------- |
| `GET`  | `/api/inventories/:ownerId`                | Recupera el inventario de un jugador                           |
| `POST` | `/api/inventories/:ownerId/items`          | Añade unidades de un objeto                                    |
| `POST` | `/api/inventories/:ownerId/items/removals` | Retira unidades de un objeto                                   |
| `GET`  | `/api/health/live`                         | El proceso responde. No consulta dependencias                  |
| `GET`  | `/api/health/ready`                        | Evalúa las dependencias reales. Responde `503` si alguna falla |
| `GET`  | `/api/version`                             | Servicio, versión y entorno                                    |

El alta crea el inventario si el jugador todavía no tiene uno: un jugador sin inventario y un inventario vacío son el mismo estado de negocio, y obligar a un alta previa solo añadiría un paso sin significado.

## Scripts

Los mismos que el resto de servicios del producto: `dev`, `build`, `start`, `start:prod`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:unit`, `test:integration`, `test:coverage`. La cobertura mínima exigida es del **80 %** y está configurada como umbral en Jest.

## Estructura

```text
src/
  domain/            Inventory, CapacityPolicy, objetos de valor y eventos.
  application/       Casos de uso, puertos, DTO y errores.
  adapters/
    inbound/http/    Controladores y contratos HTTP.
    outbound/        Persistencia y utilidades de sistema.
  infrastructure/    Configuracion, observabilidad, salud y raiz de composicion.
test/
  unit/              Pruebas unitarias por capa.
  integration/       API real levantada con el modulo completo.
```

El dominio no importa NestJS, SDK de AWS, ORM, HTTP ni drivers de base de datos, y la capa de aplicación no conoce adaptadores concretos. La restricción se verifica en CI mediante reglas de ESLint.

## Versión de TypeScript

**TypeScript 5.9.3**, no 7, porque `@nestjs/cli@11.0.24` la declara como dependencia directa. Es la misma decisión que en el resto de servicios NestJS del producto y está registrada en ADR-002.

## Docker

```bash
docker build -t nexus-battle-player-inventory:local .
docker run --rm -p 3002:3002 nexus-battle-player-inventory:local
```

La imagen es multi-etapa, se ejecuta con el usuario sin privilegios `node`, incluye solo dependencias de producción y no contiene secretos.

## Limitaciones conocidas del alcance actual

- **La persistencia es en memoria** y se pierde al reiniciar. El adaptador MongoDB depende de que ADR-005 decida el ODM; hasta entonces no se elige uno de facto. Configurar `PERSISTENCE_DRIVER=mongo` valida la configuración y lo advierte en el registro, pero no habilita un adaptador que no existe.
- El servicio **no valida que el objeto exista en el catálogo** ni que el jugador exista en Account. Comprobarlo requeriría una llamada sincrónica entre servicios o una réplica local del catálogo; ambas son decisiones de integración que corresponden a ADR-006 y no se toman de facto aquí.
- La capacidad es fija por configuración del dominio. Capacidades distintas por tipo de jugador son una extensión natural que el modelo ya admite, pero no forman parte de este alcance.

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
