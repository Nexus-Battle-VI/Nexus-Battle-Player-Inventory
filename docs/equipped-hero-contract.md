# Contrato interno: héroe equipado para Combat (HU-15, HU-25)

Contrato interno de solo lectura con el que Combat obtiene el héroe preparado de un
jugador: quién es, sus estadísticas y los efectos de su equipamiento.

| Elemento                     | Referencia                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Héroe preparado (HU-15)      | [Management#24](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/24) · [TASK #392](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/392)                                                                                |
| Efectos del equipamiento     | HU-28 [Management#75](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/75) · [TASK #152](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/152): tras equipar «deben recalcularse las estadísticas y efectos aplicables» |
| Consumidor: tabla de efectos | HU-25 [Management#72](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/72): la tabla corresponde «al tipo de héroe y a sus modificadores vigentes»                                                                                       |
| Consumidor posterior         | HU-20 [Management#64](https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/64)                                                                                                                                                               |

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
  "ready": true,
  "selectedAt": "2026-09-19T12:00:00.000Z"
}
```

`playerId` lo rellena Combat con el sujeto de **su propio** testimonio ya verificado; no
se acepta `heroId` en ninguna parte: el héroe se resuelve por el jugador. No existe
«nivel de héroe» en este dominio y el contrato no lo inventa.

| Respuesta | Cuándo                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `200`     | El jugador tiene un héroe preparado.                                                         |
| `400`     | `playerId` en blanco.                                                                        |
| `401`     | Firma interna ausente o inválida, o servicio no permitido.                                   |
| `404`     | El jugador no ha preparado ningún héroe, o el héroe salió de su inventario. **Sin cambios.** |
| `503`     | Catalog no respondió: sin sus datos no se inventan estadísticas.                             |

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

## Pruebas

- `test/unit/get-equipped-hero-for-combat.spec.ts`: sin efectos, `FIXED`, `PERCENTAGE`,
  `DICE`, condicionales, temporales, otro objetivo, varias piezas y orden, lista blanca
  exacta de claves, ausencia de `raw`/`sourceSlot`, misma fuente que HU-07, mismas llamadas
  a Catalog que HU-07 y aislamiento entre jugadores.
- `test/integration/equipped-hero-http.spec.ts`: el contrato sobre HTTP con HMAC real,
  reflejo inmediato de un cambio de equipamiento, el contrato público sin cambios, `404`,
  `401` y `503`.
