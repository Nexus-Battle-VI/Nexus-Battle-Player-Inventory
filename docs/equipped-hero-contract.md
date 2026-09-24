# Contrato interno: héroe equipado para Combat y perfil de un héroe para Missions (HU-15, HU-25, HU-19, HU-71)

Contrato interno de solo lectura con el que Combat obtiene el héroe preparado de un
jugador —quién es, sus estadísticas, los efectos de su equipamiento y sus habilidades
especiales— y con el que Missions obtiene esas mismas cosas **de un héroe concreto** que
no tiene por qué ser el preparado.

| Elemento                     | Referencia                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Héroe preparado (HU-15)      | [Management#24](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/24) · [TASK #392](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/392)                                                                                                           |
| Efectos del equipamiento     | HU-28 [Management#75](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/75) · [TASK #152](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/152): tras equipar «deben recalcularse las estadísticas y efectos aplicables»                            |
| Consumidor: tabla de efectos | HU-25 [Management#72](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/72): la tabla corresponde «al tipo de héroe y a sus modificadores vigentes»                                                                                                                  |
| Habilidades especiales       | HU-19 [Management#63](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/63) · [TASK #413](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/413): Combat las congela al iniciar la batalla y las ejecuta                                             |
| Perfil por héroe (HU-71)     | HU-71 [Management#56](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/56) · [TASK #370](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/370): Missions valida las habilidades de la estrategia y congela el perfil que enviará a Combat en HU-72 |
| Consumidor posterior         | HU-20 [Management#64](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/64)                                                                                                                                                                                          |

**Este contrato transporta datos. No define semántica de combate.** Lo que Combat hace
con cada efecto (cómo modifica la tabla de HU-25, cuándo se evalúa una condición, cómo
se apilan varios) se decide en Combat y, donde el requisito no lo define, sigue
pendiente. Ver [Lo que este contrato no define](#lo-que-este-contrato-no-define).

## Contrato

```text
GET /api/internal/v1/players/{playerId}/equipped-hero
```

```json
{
  "playerId": "cognito-sub-1",
  "heroId": "0f0a0d0e-6c1b-4d63-8a53-2c1d5b7e9a10",
  "reference": "guerrero-armas",
  "subtype": "GUERRERO_ARMAS",
  "name": "Guerrero Armas",
  "baseStats": {
    "power": 8,
    "health": 40,
    "defense": 8,
    "attack": 10,
    "damage": { "mode": "DICE", "count": 1, "sides": 4 },
    "healing": null
  },
  "effectiveStats": {
    "power": 8,
    "health": 40,
    "defense": 8,
    "attack": 13,
    "damage": { "mode": "DICE", "count": 1, "sides": 4 },
    "healing": null
  },
  "activeEffects": [
    {
      "sourceProductId": "6a3f3c2e-2b7e-4d1a-9f0a-1c9e8d7b6a55",
      "sourceProductReference": "espada-de-dos-manos",
      "kind": "STAT_MODIFIER",
      "target": "SELF",
      "statistic": "ATTACK",
      "operation": "INCREASE",
      "magnitude": { "mode": "FIXED", "amount": 3 },
      "hasActivationCondition": false,
      "appliedToStats": true
    },
    {
      "sourceProductId": "6a3f3c2e-2b7e-4d1a-9f0a-1c9e8d7b6a55",
      "sourceProductReference": "espada-de-dos-manos",
      "kind": "STAT_MODIFIER",
      "target": "SELF",
      "statistic": "CRITICAL_CHANCE",
      "operation": "INCREASE",
      "magnitude": { "mode": "PERCENTAGE", "basisPoints": 300 },
      "hasActivationCondition": false,
      "appliedToStats": false
    }
  ],
  "abilities": [
    {
      "abilityId": "2e97537a-675c-461a-b902-4fcf369083a8",
      "reference": "golpe-con-escudo",
      "name": "Golpe con escudo",
      "powerCost": { "mode": "FIXED", "amount": 2 },
      "chargeTurns": 1,
      "effects": [
        {
          "kind": "STAT_MODIFIER",
          "target": "SELF",
          "statistic": "ATTACK",
          "operation": "INCREASE",
          "magnitude": { "mode": "FIXED", "amount": 2 },
          "hasActivationCondition": false
        }
      ]
    }
  ],
  "ready": true,
  "blockers": [],
  "loadoutVersion": 0,
  "selectedAt": "2026-09-19T12:00:00.000Z"
}
```

`playerId` lo rellena Combat con el sujeto de **su propio** testimonio ya verificado; no
se acepta `heroId` en ninguna parte: el héroe se resuelve por el jugador. No existe
«nivel de héroe» en este dominio y el contrato no lo inventa.

### `blockers` y `loadoutVersion` (HU-16.1/HU-16.2, Management#401/#402)

Ampliación **aditiva** para que Combat pueda resolver elegibilidad precombate (HU-16) sin
recalcular reglas que ya son autoridad de este servicio:

- **`blockers`**: la MISMA lista que produce `HeroReadinessPolicy.assessHeroReadiness` y que
  ya viajaba en el contrato público de HU-07 (`HeroSelectionDto.readiness.blockers`). Antes
  de esta ampliación, `ready=false` no explicaba el motivo; ahora Combat recibe los mismos
  códigos que el jugador ya ve en `/inventories/me/heroes/selection`
  (`HERO_NOT_ACTIVE`, `EQUIPPED_PRODUCT_NOT_OWNED`, `EQUIPPED_PRODUCT_NOT_ACTIVE`). **No es
  una segunda taxonomía**: Combat debe reenviar estos códigos tal cual en su propia
  respuesta de elegibilidad, no reinterpretarlos ni inventar equivalentes.
- **`loadoutVersion`**: la versión real de bloqueo optimista de `HeroLoadout` (la misma que
  usa la escritura de HU-28 para detectar conflictos concurrentes). `0` cuando el héroe
  nunca tuvo loadout persistido. Permite a Combat capturar, en el momento de validar
  elegibilidad, una referencia verificable de la configuración aprobada y detectar más
  tarde si cambió (TOCTOU, DP-6 de la auditoría HU-16.1) **sin copiar el inventario**.

Un consumidor que ignore estos dos campos no se rompe (compatibilidad hacia atrás
preservada, ver [Compatibilidad y orden de despliegue](#compatibilidad-y-orden-de-despliegue)).

| Respuesta | Cuándo                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `200`     | El jugador tiene un héroe preparado.                                                         |
| `400`     | `playerId` en blanco.                                                                        |
| `401`     | Firma interna ausente o inválida, o servicio no permitido.                                   |
| `404`     | El jugador no ha preparado ningún héroe, o el héroe salió de su inventario. **Sin cambios.** |
| `503`     | Catalog no respondió: sin sus datos no se inventan estadísticas.                             |

## Ruta hermana: perfil de un héroe concreto, para Missions (HU-71)

```text
GET /api/internal/v1/players/{playerId}/heroes/{heroId}
```

**Por qué existe.** Missions valida, al guardar una estrategia de rotaciones, que cada
acción `ABILITY` use una habilidad que el héroe **tiene** (P-R4 del diseño de HU-71), y
además congela el perfil del héroe en la solicitud de simulación de HU-72. Hasta esta
ruta, este servicio solo publicaba el héroe **preparado** (`equipped-hero`), y el héroe
de una estrategia no tiene por qué ser el que el jugador tiene seleccionado.

**Es una ruta hermana, no una ampliación de la anterior.** `equipped-hero` sigue
sirviendo al héroe seleccionado para Combat y **no cambia**; esta sirve a cualquier héroe
del jugador. `:heroId` es el `productId` canónico del héroe (`equipped-hero.heroId`), no
la referencia del inventario.

El cuerpo del `200` tiene **los mismos nombres y el mismo significado** que el de
`equipped-hero` en todo lo que describe al héroe:

```json
{
  "playerId": "cognito-sub-1",
  "heroId": "0f0a0d0e-6c1b-4d63-8a53-2c1d5b7e9a10",
  "reference": "guerrero-armas",
  "subtype": "GUERRERO_ARMAS",
  "name": "Guerrero Armas",
  "baseStats": {
    "power": 8,
    "health": 40,
    "defense": 8,
    "attack": 10,
    "damage": { "mode": "DICE", "count": 1, "sides": 4 },
    "healing": null
  },
  "effectiveStats": {
    "power": 8,
    "health": 40,
    "defense": 8,
    "attack": 13,
    "damage": { "mode": "DICE", "count": 1, "sides": 4 },
    "healing": null
  },
  "activeEffects": [
    {
      "sourceProductId": "…",
      "sourceProductReference": "espada-corta",
      "kind": "STAT_MODIFIER",
      "target": "SELF",
      "statistic": "ATTACK",
      "operation": "INCREASE",
      "magnitude": { "mode": "FIXED", "amount": 3 },
      "hasActivationCondition": false,
      "appliedToStats": true
    }
  ],
  "abilities": [
    {
      "abilityId": "…",
      "reference": "golpe-con-escudo",
      "name": "Golpe con escudo",
      "powerCost": { "mode": "FIXED", "amount": 2 },
      "chargeTurns": 1,
      "effects": []
    }
  ],
  "loadoutVersion": 1
}
```

**Lo que NO viaja, y por qué.** No hay `ready`, `blockers` ni `selectedAt`: los tres son
propiedades de la **selección** (HU-07/HU-16) y el héroe de una estrategia de misión no
tiene por qué estar seleccionado. Publicarlos aquí obligaría a inventar una evaluación de
preparación y una fecha de selección que nadie ha producido. Si un consumidor necesita la
elegibilidad del héroe para una batalla, la fuente sigue siendo `equipped-hero`.

**El consumidor congela el cuerpo entero.** Missions lo guarda tal cual como perfil del
héroe en la solicitud de simulación de HU-72; por eso los nombres y la forma coinciden con
los de `equipped-hero` y no se renombran aquí.

| Respuesta | Cuándo                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `200`     | El héroe es del jugador.                                                                                                        |
| `400`     | `playerId` o `heroId` en blanco.                                                                                                |
| `401`     | Firma interna ausente o inválida, o servicio distinto de `missions`.                                                            |
| `404`     | El héroe no está en el inventario del jugador, Catalog no lo conoce, o su tipo no es `HEROE`. **Lleva `code: HERO_NOT_OWNED`.** |
| `503`     | Catalog no respondió.                                                                                                           |

**El `code` del `404` es parte del contrato.** El consumidor solo interpreta el `404` como
«el héroe no es de ese jugador» si el cuerpo trae `HERO_NOT_OWNED`; cualquier otro `404`
—por ejemplo el de una ruta inexistente— lo trata como un resultado desconocido y **no**
guarda la estrategia. Distinguir «no es suyo» de «no existe» no revela nada nuevo: los dos
casos responden lo mismo, igual que en el resto del servicio.

## Autenticación

`@InternalOnly()` + `InternalServiceGuard`, el mismo mecanismo que el resto de contratos
internos de este servicio ([`purchase-grants.md`](purchase-grants.md),
[`product-owners.md`](product-owners.md)): HMAC-SHA256 sobre
`INTERNAL_SERVICE_AUTH_SECRET`, cabeceras `x-internal-service`, `x-internal-timestamp` y
`x-internal-signature`. La cadena firmada es:

```text
combat
GET
/api/internal/v1/players/{playerId}/equipped-hero
<TIMESTAMP>
<SHA256 del JSON canónico de {}>
```

La ruta del perfil por héroe se firma igual, con `missions` como servicio y su propia ruta
(el `heroId` va en la ruta, nunca en la cadena de consulta):

```text
missions
GET
/api/internal/v1/players/{playerId}/heroes/{heroId}
<TIMESTAMP>
<SHA256 del JSON canónico de {}>
```

**Permiso mínimo por ruta.** `missions` **no** entra en la lista global de servicios
autorizados de este servicio (`commerce`, `notifications`, `combat`): la ruta del perfil
declara `@InternalCallers('missions')`, así que solo ese servicio puede llamarla y los
demás siguen recibiendo `401` en ella. La lista global no se amplía, y `missions` sigue sin
poder llamar a `/api/internal/v1/inventory/grants`.

No usa JWT de jugador y no debe exponerse mediante el proxy público (`/api/internal*` no
se publica en Caddy). Combat nunca debe aceptar `subtype`, `effectiveStats` ni
`activeEffects` que lleguen desde Web: la única fuente es esta respuesta, autenticada de
servicio a servicio.

## `activeEffects`

### De dónde salen

De `HeroEquipmentDto.activeEffects`, el resultado que HU-28 ya produce **junto con**
`effectiveStats` en una sola pasada (`computeEffectiveStats`). Este contrato **no
recalcula** nada específicamente para Combat:

```text
loadout + Catalog (lookup)  ─►  computeEffectiveStats (HU-28)  ─►  effectiveStats + activeEffects
                                                                          │
                       GetHeroSelection (HU-07) ─── GetEquippedHeroForCombat (proyección)
```

- No se vuelve a consultar Catalog ni a recorrer el equipamiento: `GetEquippedHeroForCombat`
  sigue delegando por completo en `GetHeroSelection`. Una prueba fija que hace exactamente
  las mismas llamadas a Catalog que HU-07.
- Los efectos y las estadísticas de una respuesta describen **el mismo estado**: no hay
  ventana en la que uno refleje un equipamiento y el otro no.
- El orden es estable: el de las ranuras (`WEAPON_1`, `WEAPON_2`, `HELMET`, `CHEST`,
  `GLOVES`, `BRACERS`, `PANTS`, `SHOES`, `ITEM_1`, `ITEM_2`), y dentro de cada producto el
  orden de sus efectos en Catalog. No depende del orden en que se equipó.
- Un héroe sin equipamiento que module algo devuelve `[]`, no ausente.

### Campos

| Campo                                       | Significado                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                                      | Familia canónica del efecto (`STAT_MODIFIER`, `DAMAGE`, `HEALING`, ...). Tal como la publica Catalog.                          |
| `target`                                    | A quién afecta (`SELF`, `ALLY`, `ALLIED_GROUP`, `OPPONENT`, `ENEMY_GROUP`). Un efecto al oponente no modifica al héroe propio. |
| `statistic`, `operation`                    | Presentes en `STAT_MODIFIER`. Ausentes cuando el efecto no los tiene: no se inventan.                                          |
| `magnitude`                                 | `FIXED { amount }`, `PERCENTAGE { basisPoints }` o `DICE { count, sides }`. Sin colapsar ni convertir.                         |
| `durationTurns`                             | Ausente = permanente. Presente = temporal.                                                                                     |
| `hasActivationCondition`                    | `true` si el efecto está sujeto a una condición. Es un **indicador**: la condición no viaja.                                   |
| `appliedToStats`                            | `true` si el efecto **ya está reflejado** en `effectiveStats`. Ver [Doble aplicación](#doble-aplicación).                      |
| `sourceProductId`, `sourceProductReference` | Procedencia, **solo para trazabilidad** (qué producto origina el efecto). No sirve para decidir nada.                          |

### Doble aplicación

`appliedToStats` distingue dos situaciones que un consumidor no debe confundir:

- `true`: el efecto ya está dentro de `effectiveStats`. Un `+3 ATTACK` así marcado es la
  razón de que `effectiveStats.attack` valga 13 y no 10. **No se vuelve a sumar.**
- `false`: el efecto se conserva estructurado y **no** está en `effectiveStats`. Es la
  situación de todo lo que HU-28 no refleja como número: crítico, daño y sanación como
  efecto, efectos a otro objetivo, temporales y condicionales.

HU-28 marca `appliedToStats = true` solo para un `STAT_MODIFIER` **permanente** (sin
duración ni condición), dirigido a `SELF`, sobre `POWER`, `HEALTH`, `DEFENSE` o `ATTACK`.

### Condiciones de activación

`hasActivationCondition = true` significa «no tratar como modificador permanente». La
condición en sí (`EVERY_N_TURNS`, `STAT_COMPARISON`, ...) **no cruza la frontera**: hoy
nadie la evalúa. Cuando una HU defina cuándo y cómo se evalúa, el contrato debe
ampliarse con un campo normalizado y versionado, no reabrirse con `raw`. Player-Inventory
tampoco evalúa condiciones: un `if` sobre un valor sin definir sería seguridad aparente.

### Minimización: qué no viaja y por qué

| Excluido                         | Motivo                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw`                            | Es el objeto crudo de Catalog (`unknown`). Exponerlo dejaría un contrato abierto que acopla a Combat con una estructura de Catalog que aquí nadie versiona. **El DTO es cerrado**: cada campo es una decisión. |
| `sourceSlot`                     | Propiedad del loadout (dónde está puesto el producto), no del efecto. Combat no necesita el detalle de ranuras.                                                                                                |
| La condición de activación       | Ver arriba: nadie la evalúa todavía.                                                                                                                                                                           |
| `imageUrl`, precio, descripción… | Datos visuales o comerciales; sin relación con el combate.                                                                                                                                                     |
| Inventario completo, ranuras     | Combat necesita al héroe y sus efectos, no el inventario del jugador.                                                                                                                                          |

La proyección es una **lista blanca campo a campo**, no un `{ ...efecto }` menos `raw`: si
`EquippedEffect` gana un campo mañana, no cruza la frontera por accidente.

El contrato **público** de HU-07/HU-28 (`GET /inventories/me/heroes/selection`,
`.../equipment`) **no cambia**: sigue exponiendo `raw` y `sourceSlot` al propio jugador.
Una prueba de integración lo fija.

## `abilities` (HU-19)

Las tres acciones especiales del héroe (Tabla 7 del documento oficial), resueltas desde
Catalog para que Combat las congele al iniciar la batalla y las ejecute
(`hu-19-skills-v1` en Infrastructure, §10). **Este contrato transporta datos; no ejecuta
nada ni decide qué efecto es soportado.**

### De dónde salen

Las habilidades **no son equipamiento** (no están en `effectiveStats` ni en `activeEffects`)
y `GetHeroSelection` (HU-07) solo conserva sus referencias. Por eso `GetEquippedHeroForCombat`
las resuelve a través del puerto de lectura de Catalog con **dos llamadas más** que
HU-07: `getByReference` del producto del héroe (sus referencias `abilities`) y **una sola**
`lookup` por todas las habilidades (`type: HABILIDAD`), nunca una por habilidad. El
equipamiento **no** se vuelve a leer.

### Campos

| Campo         | Significado                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `abilityId`   | `productId` de Catalog. Es el identificador que el cliente envía en `useSkill`.                                                           |
| `reference`   | Alias (`sku`) de Catalog.                                                                                                                 |
| `name`        | Texto para mostrar.                                                                                                                       |
| `powerCost`   | `{ mode: 'FIXED', amount }` (entero ≥ 1) o `{ mode: 'ALL_AVAILABLE' }` («todos los puntos de poder»). Tal como lo publica Catalog.        |
| `chargeTurns` | Turnos de carga (Catalog v1: 1). Entero ≥ 1.                                                                                              |
| `effects[]`   | `kind`, `target`, `statistic`, `operation`, `magnitude`, `durationTurns` y `hasActivationCondition`. Sin procedencia ni `appliedToStats`. |

Orden: el de las referencias `abilities` del héroe en Catalog (no el alfabético de la
`lookup`). Lista blanca campo a campo: **no viajan `raw`, la condición de activación, el
código de una inmunidad ni el de un estado**; solo `hasActivationCondition`.

### Qué se omite y qué se propaga

- Una referencia que Catalog no resuelve, un producto que no es `HABILIDAD` o una habilidad
  cuyos atributos no cumplen el contrato canónico (costo sin monto entero ≥ 1, recarga que no
  es un entero ≥ 1) **se omite**: el héroe simplemente no la tiene; no se inventa un costo ni
  una recarga y no se tumba la respuesta.
- Si Catalog **no responde**, se propaga (`503`), igual que el resto del contrato: sin sus
  datos no se inventan habilidades.

## Lo que este contrato no define

Estos puntos **no están definidos** por ningún requisito aprobado y este contrato no los
resuelve. Que un efecto viaje aquí no significa que Combat sepa aplicarlo.

1. **Unidad de `CRITICAL_CHANCE` con `PERCENTAGE`.** Catalog publica p. ej.
   `CRITICAL_CHANCE INCREASE PERCENTAGE 300`. No existe fuente formal que diga si eso es
   **+3 puntos porcentuales absolutos** (como el «+6 %» de la Tabla 23 del documento
   oficial) o **+3 % relativo** sobre el crítico base. Ni HU-25, ni HU-28, ni sus Tasks, ni
   el contrato de Catalog lo fijan. Se transporta `basisPoints: 300` tal cual.
2. **Apilamiento** de varios efectos de la misma estadística (varias piezas).
3. **Evaluación** de condiciones de activación y de efectos temporales.
4. **Efectos que no son `STAT_MODIFIER`** (`DAMAGE`, `HEALING`, `REFLECT_DAMAGE`, ...).
5. **Semántica de las habilidades** (`abilities`): qué efecto de una habilidad se ejecuta y
   cuál se rechaza lo decide Combat (`hu-19-skills-v1`, §10.2). La **épica** no viaja aquí: no
   existe fuente ni estado de «épica activa» (HU-31, auditoría en Management#78).

El punto 1 está registrado también en Combat (`docs/hu-25-effect-control-table.md`). Lo
decide el PO; no está aceptado.

Nota de origen: al leer los efectos de Catalog, `parseEffect` omite un `statistic` u
`operation` que no reconoce, en lugar de rechazar el efecto. Catalog valida esos enums de
forma estricta, así que con datos de Catalog vigentes no ocurre; el consumidor no debe
reinterpretar un `STAT_MODIFIER` que llegue sin `statistic`.

## Compatibilidad y orden de despliegue

- **Cambio aditivo.** Se añade `activeEffects`; el resto de campos conserva forma y
  significado. El `404` de «jugador sin héroe preparado» **no cambia**.
- Un consumidor que ignore campos desconocidos no se rompe. El de Combat validaba solo
  `playerId`, `heroId` y `effectiveStats.power`.
- **El productor se despliega primero.** Combat, al pasar a exigir `activeEffects`, rechaza
  como inválida una respuesta que no lo traiga (no lo sustituye por `[]`: eso haría que
  Combat usara la tabla base ignorando el equipamiento real). Desplegar Combat antes que esta
  versión haría fallar el ingreso a salas.

  ```text
  1. Player-Inventory con activeEffects   ─►  verificar el endpoint interno
  2. Combat que exige activeEffects
  ```

- **HU-19: `abilities` sigue el mismo orden.** Combat exige `abilities` (no lo sustituye por
  `[]`: un héroe sin sus habilidades por un despliegue mal ordenado parecería no tenerlas).
  Desplegar Combat antes de esta versión haría fallar el ingreso a salas (`503`).

- **HU-71: la ruta del perfil por héroe es aditiva.** No cambia la ruta de `equipped-hero`,
  ni su `404`, ni ningún campo de su respuesta: es una ruta nueva con su propio permiso. El
  productor (este servicio) se despliega primero; Missions puede quedarse con su doble en
  memoria mientras tanto, porque un `503` de esta ruta **no** corrompe nada: solo impide
  guardar estrategias.

  ```text
  1. Player-Inventory con GET /players/{playerId}/heroes/{heroId}
  2. Missions con HERO_ABILITIES_DRIVER apuntando a esta ruta
  ```

## Pruebas

- `test/unit/get-equipped-hero-for-combat.spec.ts`: sin efectos, `FIXED`, `PERCENTAGE`,
  `DICE`, condicionales, temporales, otro objetivo, varias piezas y orden, lista blanca
  exacta de claves, ausencia de `raw`/`sourceSlot`, misma fuente que HU-07, mismas llamadas
  a Catalog que HU-07 y aislamiento entre jugadores.
- `test/integration/equipped-hero-http.spec.ts`: el contrato sobre HTTP con HMAC real,
  reflejo inmediato de un cambio de equipamiento, el contrato público sin cambios, `404`,
  `401` y `503`.
- `test/unit/get-hero-profile-for-mission.spec.ts`: pertenencia (propio, ajeno, no `HEROE`),
  héroe por `productId` y por `sku`, `heroId` canónico en la respuesta, héroe que el jugador
  nunca seleccionó, loadout real y ausencia de loadout, habilidades resueltas y omitidas, y
  la lista blanca exacta de campos (sin `ready`, `blockers` ni `selectedAt`).
- `test/unit/hero-profile-shared.spec.ts`: la resolución compartida hace **una** `lookup`
  para todas las habilidades, propaga el fallo de Catalog y omite la habilidad desconocida;
  y la proyección de efectos no deja cruzar `raw` ni `sourceSlot`.
- `test/unit/no-duplicated-abilities-resolution.spec.ts`: guarda estática — solo el módulo
  compartido resuelve habilidades contra Catalog —, para que una tercera implementación
  falle en CI.
- `test/integration/hero-profile-http.spec.ts`: la petición **exacta** del cliente de
  Missions (ruta, `x-internal-service: missions`, firma sobre cuerpo vacío), `200` con
  `heroId` y `abilities[].abilityId`, `404` con `code: HERO_NOT_OWNED`, `401` para los
  servicios de la lista global, `401` con una firma de otra ruta, `503` con Catalog caído y
  el control de que la lista global no se amplió.
