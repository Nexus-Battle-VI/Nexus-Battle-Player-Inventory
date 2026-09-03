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

## Verificacion de identidad

El servicio comprueba el testimonio que acompana a cada peticion contra el JWKS del user pool de Cognito ([ADR-004](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/main/docs/adr/ADR-004-identity-directory.md)). Se verifica el **token de acceso**, no el de identidad: el de identidad describe al usuario para la interfaz, el de acceso es el que autoriza y el unico cuyo `client_id` puede comprobarse.

La comprobacion de firma la hace [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify). **No se implementa verificacion criptografica a mano**: es la clase de codigo donde un error sutil no falla, sino que acepta tokens falsificados en silencio.

**La proteccion es el comportamiento por defecto.** El guard se registra de forma global y hay que excluir explicitamente lo que deba ser publico con `@Public()`. Al reves, cualquier endpoint nuevo naceria desprotegido y ese olvido no falla ninguna prueba.

| Ruta                                            | Proteccion                                 |
| ----------------------------------------------- | ------------------------------------------ |
| `GET /api/inventories/:ownerId`                 | Testimonio valido **y `ownerId` == `sub`** |
| `POST /api/inventories/:ownerId/items`          | Testimonio valido **y `ownerId` == `sub`** |
| `POST /api/inventories/:ownerId/items/removals` | Testimonio valido **y `ownerId` == `sub`** |
| `GET /api/health/*`                             | **Publica**                                |

### El `ownerId` de la URL tiene que coincidir con el testimonio

Antes bastaba cambiarlo para leer, llenar o **vaciar** el inventario de cualquier jugador. El identificador sigue en la ruta porque identifica el recurso; lo que cambia es que ahora tiene que coincidir con el sujeto verificado.

Un inventario ajeno responde **404 y no 403**: distinguirlos confirmaria que ese jugador existe, y con eso se puede enumerar quien juega. Un administrador queda exento.

### Un binario de produccion sin autenticacion no arranca

Con `NODE_ENV=production` y `AUTH_MODE=disabled`, `loadConfig` lanza `ConfigurationError` y el servicio **no llega a escuchar**. Es la traduccion en codigo del blocker de ADR-004: un aviso en el registro se pasa por alto; un arranque que falla, no.

| Variable             | Efecto                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| `AUTH_MODE=disabled` | Se atribuye la **identidad anonima** a toda peticion. Solo desarrollo local |
| `AUTH_MODE=jwt`      | Exige `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID`                          |

Con `disabled` no se deja pasar sin mas: se atribuye el sujeto literal `anonymous` con todos los roles. Sin proveedor **no se sabe** quien realiza la peticion, y el dato que se guarde debe decirlo. Un registro firmado por `anonymous` es honesto; uno firmado por un identificador sin verificar, no.

**El despliegue corre con `AUTH_MODE=jwt`**, no con `disabled`: este servicio verifica de verdad quien realiza cada peticion, comprobado de extremo a extremo. `disabled` sigue existiendo para desarrollo local, y con `NODE_ENV=production` impide arrancar.

### De donde sale el rol que este servicio aplica

Los roles llegan en el claim `cognito:groups`. **Los grupos que no corresponden a un rol conocido se descartan**: aceptarlos convertiria el pool en una fuente de roles arbitrarios, donde bastaria crear un grupo con cualquier nombre para inventar un permiso.

Ese claim no lo llena el proveedor por su cuenta. **La fuente de verdad del rol
es Account**, que lo guarda en `account_roles` (PostgreSQL) y lo refleja en los
grupos del pool para que viaje dentro del testimonio. Conviene saberlo por dos
motivos:

- Este servicio **no debe consultar el rol a Account** en cada peticion. Lo lee
  del testimonio, que ya viene firmado, y por eso una caida de Account no tumba
  la autorizacion de este servicio.
- Un rol recien concedido **no aparece hasta que se emite un testimonio nuevo**.
  El anterior sigue siendo valido y sigue diciendo lo que decia cuando se emitio.

Hasta el 2026-08-29 ese reflejo no existia: Account escribia el rol en su base y
el testimonio viajaba sin `cognito:groups`, de modo que este servicio veia **sin
ningun rol** a quien se hubiera registrado. No daba sintoma porque ninguna puerta
de este servicio pide `PLAYER`, pero la divergencia era invisible, no
inexistente.

## Persistencia

MongoDB con el **driver oficial** ([ADR-012](https://github.com/Nexus-Battle-VI/Nexus-Battle-Infrastructure/blob/main/docs/adr/ADR-012-orm-odm.md)). No hay ODM: el documento que se guarda es exactamente el que se lee en el adaptador.

| Variable                    | Efecto                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `PERSISTENCE_DRIVER=memory` | Repositorio en proceso. **El estado se pierde al reiniciar** |
| `PERSISTENCE_DRIVER=mongo`  | Adaptador real. Exige `MONGODB_URI`                          |

### El esquema no se migra al arrancar

```bash
npm run migrate
```

Es un paso explícito del despliegue, y el motivo es concreto: migrar desde el arranque hace que **varias réplicas migren a la vez**, y que un despliegue con una migración rota deje el servicio en **bucle de reinicio** en lugar de fallar una sola vez, de forma visible.

MongoDB no trae migrador, así que hay uno propio: una colección `_migrations` con el nombre como `_id`, cuya unicidad da exclusión mutua real. Si el proceso muere a medias, la siguiente ejecución se niega a continuar y dice cuál quedó incompleta.

### Las ranuras van embebidas, y eso decide lo demás

No están en otra colección. No tienen sentido fuera de su inventario, están acotadas por la capacidad y se leen y escriben siempre con él.

La consecuencia práctica es la que importa: el agregado entero es **un documento**, y en MongoDB la escritura de un documento ya es atómica. **No hace falta transacción.**

El identificador del propietario es el `_id`: un jugador tiene exactamente un inventario, así que MongoDB garantiza esa unicidad sin índice adicional.

### Los recuentos son `Int32`

El driver guardaría un `number` como `double` de BSON, y **un recuento no es un número con decimales**.

Aquí **sí** se deja promocionar el entero, a diferencia de Catalog y Commerce: allí el dinero es de 64 bits y no cabe en el número de JavaScript. Un `int32` siempre cabe exacto, así que no hay nada que perder.

### Dos invariantes que el validador no puede expresar

Y conviene decirlo, porque un validador que aparenta cubrirlas sería peor que no tenerlo:

| Invariante                          | Por qué `$jsonSchema` no llega                               |
| ----------------------------------- | ------------------------------------------------------------ |
| Sin objetos repetidos entre ranuras | `uniqueItems` compara documentos completos, no una propiedad |
| Ranuras ≤ capacidad                 | Sería comparar un campo con otro                             |

Las comprueba la traducción al leer, y hay pruebas contra el motor real que escriben justo esos documentos: el validador los acepta —a propósito— y la lectura falla.

### La versión del driver está fijada en la línea 6.x

La `7.6.0` **no conecta** con MongoDB 8.0. Queda registrado en ADR-012.

### Pruebas contra el motor real

```bash
npm run test:db
```

Levantan MongoDB 8.0 en un contenedor con Testcontainers. **Necesitan Docker**, y por eso están fuera de `npm test`: quien trabaja en el dominio o en los casos de uso no debería necesitarlo. El CI ejecuta ambas suites.

Lo que comprueban no se puede comprobar de otra forma: que las restricciones existan de verdad y que el guardado haga lo que dice. Un doble de prueba habría pasado con un esquema equivocado.

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

- **La persistencia por defecto es en memoria y se pierde al reiniciar.** Con `PERSISTENCE_DRIVER=mongo` opera el adaptador real sobre MongoDB con el driver oficial, probado contra un motor en contenedor. El repositorio en memoria no es un resto del andamiaje: es lo que permite probar el dominio y los casos de uso **sin Docker**. El driver está fijado en la línea `6.x`: la `7.6.0` no conecta con MongoDB 8.0.
- El servicio **no valida que el objeto exista en el catálogo** ni que el jugador exista en Account. Comprobarlo requeriría una llamada sincrónica entre servicios o una réplica local del catálogo; ambas son decisiones de integración que corresponden a ADR-006 y no se toman de facto aquí.
- La capacidad es fija por configuración del dominio. Capacidades distintas por tipo de jugador son una extensión natural que el modelo ya admite, pero no forman parte de este alcance.

## Entrega de compras

El contrato HMAC, resultados idempotentes, rechazo terminal y requisitos de Mongo replica set estan en [docs/purchase-grants.md](docs/purchase-grants.md).

## Contribución

Se aplican las convenciones descritas en [CONTRIBUTING.md](CONTRIBUTING.md) y la [política de trazabilidad entre repositorios](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/blob/main/docs/governance/cross-repository-traceability.md) de Management.

## Licencia

`Licensing pending project governance`. Este repositorio todavía no tiene una licencia asignada; su definición requiere autorización del gobierno del proyecto.
