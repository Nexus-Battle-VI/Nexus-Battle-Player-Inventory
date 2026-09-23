# HU-08 — Matriz de trazabilidad y criterios de prueba

Task `#190` (HU-08.3). Trazabilidad: `RF-08` → HU-08 (`#17`) → Tasks `#188`, `#189`,
`#190` → este documento y `docs/hu-08-progresion.md`.

## 1. Por qué existe este documento

La Task pide construir `RF-08 → CA → escenario → nivel → resultado esperado → tipo de prueba →
script`. La matriz de la sección 4 es esa tabla, y es el contrato que las suites automatizadas
materializan: cada fila se puede rastrear hasta un `it` concreto y hasta el criterio de aceptación
que cubre.

**Antes de la Task `#189` no existía ninguna prueba de esta regla.** Las que hay ahora se crearon
junto con la implementación, y esta matriz es su índice verificable: **109 casos unitarios y 12
contra MongoDB real**, todos dentro de las suites de HU-08.

## 2. Qué se prueba: la tabla vigente, no la fórmula de `CA-03`

El comportamiento verificado es el de la aclaración funcional posterior al enunciado:

- **Tabla de umbrales acumulados:** `100 · 200 · 400 · 800 · 1.600 · 3.200 · 6.400 · 12.800`, uno por
  nivel de 1 a 8, enteros y sin decimales.
- **Fronteras de nivel:** nivel 1 desde `0` (es el suelo), nivel 2 desde `200`, nivel 3 desde `400`,
  nivel 4 desde `800`, nivel 5 desde `1.600`, nivel 6 desde `3.200`, nivel 7 desde `6.400` y nivel 8
  desde `12.800`. **`749` sigue siendo nivel 3**, porque el nivel 4 exige `800`.
- **Nivel desde el acumulado:** el mayor `L` cuyo umbral no supere la experiencia; el nivel 1 es el
  suelo.
- **La experiencia solo crece:** subir de nivel no la descuenta.
- **Un otorgamiento puede cruzar varios umbrales:** el nivel se calcula sobre el acumulado nuevo.
- **Tope en 8:** la experiencia sigue creciendo y no se descarta; la operación no se rechaza.

`CA-03` sigue enunciando `100 × 1,2^(Nivel − 1)`, que produce **otra** serie. La divergencia es real
y está medida en `docs/hu-08-progresion.md`, sección 3; este documento **no la da por resuelta** y
la sección 8 explica por qué no hay ninguna prueba que la declare cumplida.

## 3. Criterios de aceptación cubiertos, y los que no

La Task advierte que no debe tratarse como una nueva regla funcional «el criterio genérico que
únicamente indique que todos los criterios deben aprobarse; esa condición corresponde a
aceptación/DoD». Por eso **`CA-08` no aparece como escenario**.

| CA    | Enunciado                                                       | ¿Tiene casos?                                         |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------- |
| CA-01 | El nivel actual produce el umbral del siguiente nivel           | **Sí**                                                |
| CA-02 | Los héroes progresan de nivel 1 a nivel 8                       | **Sí**                                                |
| CA-03 | El umbral se calcula con `100 × 1,2^(Nivel−1)`                  | **NO — divergente.** Ver sección 8                    |
| CA-04 | El cálculo usa como entrada el nivel actual                     | **Sí**                                                |
| CA-05 | No se calcula un siguiente nivel fuera del rango máximo         | **Sí**                                                |
| CA-06 | El nivel actúa como factor multiplicador sobre las estadísticas | **NO — fuera de alcance.** Ver sección 7              |
| CA-07 | El valor queda disponible como umbral del siguiente nivel       | **Sí**                                                |
| CA-08 | Un criterio obligatorio fallido impide aceptar la HU            | **No es un escenario: es la condición de aceptación** |

Además de los `CA`, se prueban las reglas que el PO fijó sobre la experiencia y que no tienen
criterio propio en el Issue (`RF-08`): que sea acumulada, que no se reste, que un otorgamiento
pueda cruzar varios umbrales, y que en el tope siga creciendo.

## 4. Matriz de trazabilidad

Leyenda de tipo:

- **U** — unitaria pura (`test/unit`), sin infraestructura.
- **U-int** — unidad **de integración en proceso** (`test/unit`): ejercita la interacción entre
  la operación de progresión, la regla de cálculo y la consulta del dato, cableadas entre sí con
  el adaptador en memoria. No es una prueba de `test/integration`, que aquí levanta la
  aplicación NestJS por HTTP y no cubre la progresión porque **no hay endpoint**.
- **DB** — contra **MongoDB real** en contenedor (`test/db`), donde la cadena es persistencia →
  regla → consumidor.

### CA-01 — la tabla produce el umbral esperado

| RF    | CA    | Escenario                                          | Nivel | Resultado esperado                                   | Tipo | Script                                   |
| ----- | ----- | -------------------------------------------------- | ----- | ---------------------------------------------------- | ---- | ---------------------------------------- |
| RF-08 | CA-01 | El primer umbral es el coeficiente que se conservó | 1     | `AVAILABLE`, siguiente 2, `200`                      | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-01 | Nivel intermedio                                   | 4     | `AVAILABLE`, siguiente 5, `1600`                     | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-01 | Último nivel con siguiente nivel                   | 7     | `AVAILABLE`, siguiente 8, `12800`                    | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-01 | Los siete umbrales, uno a uno                      | 1..7  | `200 · 400 · 800 · 1600 · 3200 · 6400 · 12800`       | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-01 | La cadena completa contra la tabla de referencia   | 1..8  | Coincide entrada a entrada con el fixture            | U    | `experience-threshold-reference.spec.ts` |
| RF-08 | CA-01 | Las dos direcciones concuerdan                     | 1..7  | El acumulado del umbral produce el nivel que declara | U    | `experience-policy.spec.ts`              |

### Las reglas del PO sobre la experiencia acumulada

| RF    | Regla del PO                                   | Escenario                            | Entrada                       | Resultado esperado                              | Tipo     | Script                                                     |
| ----- | ---------------------------------------------- | ------------------------------------ | ----------------------------- | ----------------------------------------------- | -------- | ---------------------------------------------------------- |
| RF-08 | Nivel desde el acumulado                       | Los cuatro vectores de la aclaración | `749`, `3500`, `890`, `13000` | `3`, `6`, `4`, `8`                              | U        | `experience-policy.spec.ts`                                |
| RF-08 | El nivel 1 es el suelo                         | Por debajo del primer umbral         | `0`, `99`, `100`, `199`       | Siempre `1`                                     | U        | `experience-policy.spec.ts`                                |
| RF-08 | Cada umbral se alcanza en su valor             | Fronteras exactas                    | `200`, `400`, … `12800`       | El nivel de ese umbral, y uno menos justo antes | U        | `experience-policy.spec.ts`                                |
| RF-08 | Es monótona                                    | Barrido de 0 a 14.000                | paso 25                       | El nivel nunca decrece                          | U        | `experience-policy.spec.ts`                                |
| RF-08 | El tope no descarta experiencia                | Por encima de la tabla               | `13500`, `1.000.000`          | Nivel `8`, sin rechazo                          | U        | `experience-policy.spec.ts`                                |
| RF-08 | La XP no se resta al subir                     | `749 + 100`                          | —                             | Acumulado `849`, nivel `4`                      | U, U-int | `hero-progression.spec.ts`, `get-hero-progression.spec.ts` |
| RF-08 | Un otorgamiento cruza varios umbrales          | `190 + 700`                          | —                             | Acumulado `890`, nivel `4`                      | U        | `hero-progression.spec.ts`                                 |
| RF-08 | En el tope la XP sigue creciendo               | `13.000 + 500`                       | —                             | Acumulado `13.500`, nivel `8`                   | U        | `hero-progression.spec.ts`                                 |
| RF-08 | La recompensa es entera                        | `14,4` rechazado, `14` aceptado      | —                             | `DomainError` / acumulado `14`                  | U        | `hero-progression.spec.ts`                                 |
| RF-08 | Acreditar no muta ni versiona                  | Tras `awardExperience`               | —                             | Instancia nueva, `version` intacta              | U        | `hero-progression.spec.ts`                                 |
| RF-08 | Los tres ejemplos del PO, contra la referencia | Acreditación                         | —                             | Acumulado y nivel del fixture                   | U        | `experience-threshold-reference.spec.ts`                   |

### CA-04 — la entrada es el nivel actual, y solo eso

| RF    | CA    | Escenario                               | Nivel      | Resultado esperado                               | Tipo | Script                                                                |
| ----- | ----- | --------------------------------------- | ---------- | ------------------------------------------------ | ---- | --------------------------------------------------------------------- |
| RF-08 | CA-04 | La operación recibe el nivel y nada más | cualquiera | No recibe héroe, equipamiento ni jugador         | U    | `experience-policy.spec.ts`                                           |
| RF-08 | CA-04 | El nivel consultado no se modifica      | 1..8       | El valor de entrada queda intacto tras consultar | U    | `experience-policy.spec.ts`, `experience-threshold-reference.spec.ts` |

### CA-05 — nivel máximo: no existe el nivel 9

| RF    | CA    | Escenario                                             | Nivel   | Resultado esperado                           | Tipo   | Script                           |
| ----- | ----- | ----------------------------------------------------- | ------- | -------------------------------------------- | ------ | -------------------------------- |
| RF-08 | CA-05 | Nivel máximo                                          | 8       | `MAX_LEVEL`, sin umbral, `forNextLevel` nulo | U      | `experience-policy.spec.ts`      |
| RF-08 | CA-05 | El siguiente nivel nunca supera el máximo             | 1..7    | `forNextLevel === nivel + 1 ≤ 8`             | U      | `experience-policy.spec.ts`      |
| RF-08 | CA-05 | La operación que impone el tope                       | 8       | `HeroLevel.next()` devuelve `null`           | U      | `hero-progression.spec.ts`       |
| RF-08 | CA-05 | `isMax()` solo en el máximo                           | 1, 7, 8 | Cierto solo en 8                             | U      | `hero-progression.spec.ts`       |
| RF-08 | CA-05 | El máximo se persiste y se relee sin producir nivel 9 | 8       | `isAtMaxLevel` cierto, umbral `MAX_LEVEL`    | **DB** | `mongo-hero-progression.spec.ts` |

### CA-02 — rango 1..8 y entradas inválidas

| RF    | CA    | Escenario                                           | Nivel                                         | Resultado esperado                             | Tipo | Script                                   |
| ----- | ----- | --------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ---- | ---------------------------------------- |
| RF-08 | CA-02 | Nivel inferior al rango                             | `0`, `-1`                                     | `DomainError`                                  | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | Nivel superior al rango                             | `9`, `99`                                     | `DomainError`                                  | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | Nivel no entero, sin truncar                        | `2.5`, `7.0000001`                            | `DomainError`                                  | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | Tipo de entrada inválido                            | `'3'`, `NaN`, `Infinity`, `null`, `undefined` | `DomainError`                                  | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | Acumulado inválido                                  | `-1`, `1.5`, `NaN`, `'890'`                   | `DomainError`                                  | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | No normaliza en silencio                            | `9`                                           | Falla; **no** se recorta a 8                   | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | El rango del contrato no cambia                     | —                                             | `MIN_HERO_LEVEL === 1`, `MAX_HERO_LEVEL === 8` | U    | `experience-threshold-reference.spec.ts` |
| RF-08 | CA-02 | El predicado de rango                               | varios                                        | Cierto solo para enteros en `1..8`             | U    | `experience-policy.spec.ts`              |
| RF-08 | CA-02 | Un documento persistido fuera de rango no se acepta | 0, 9, `-1`, `1.5`                             | `DomainError` al restaurar                     | U    | `hero-progression.spec.ts`               |
| RF-08 | CA-02 | La tabla no contiene fracciones                     | —                                             | Los ocho valores son enteros                   | U    | `experience-policy.spec.ts`              |

### CA-07 — el umbral queda disponible para el consumidor

| RF    | CA    | Escenario                                                            | Nivel       | Resultado esperado                  | Tipo      | Script                            |
| ----- | ----- | -------------------------------------------------------------------- | ----------- | ----------------------------------- | --------- | --------------------------------- |
| RF-08 | CA-07 | La operación reutilizable se resuelve y calcula sin conocer la tabla | 4, 8        | `1600` hacia el 5; `MAX_LEVEL` en 8 | **U-int** | `hero-progression-wiring.spec.ts` |
| RF-08 | CA-07 | La misma operación resuelve el nivel de un acumulado                 | 749, 890    | `3`, `4`                            | **U-int** | `hero-progression-wiring.spec.ts` |
| RF-08 | CA-07 | El caso de uso deriva el umbral del nivel persistido                 | 5           | `3200` hacia el 6                   | **U-int** | `get-hero-progression.spec.ts`    |
| RF-08 | CA-07 | El consumidor recibe el umbral válido leyendo de la base             | 7           | `12800` hacia el 8                  | **DB**    | `mongo-hero-progression.spec.ts`  |
| RF-08 | CA-07 | El consumidor recibe la condición de nivel máximo                    | 8           | `MAX_LEVEL`                         | **U-int** | `get-hero-progression.spec.ts`    |
| RF-08 | CA-07 | El consumidor recibe error controlado ante entrada inválida          | `''`, vacío | `DomainError`                       | **U-int** | `get-hero-progression.spec.ts`    |

### Determinismo y regresión de la tabla

| RF    | CA/regla | Escenario                                   | Nivel | Resultado esperado                                        | Tipo | Script                                       |
| ----- | -------- | ------------------------------------------- | ----- | --------------------------------------------------------- | ---- | -------------------------------------------- |
| RF-08 | CA-01    | Consulta repetida, mismo resultado          | 1..8  | Idéntico en cada llamada                                  | U    | `experience-policy.spec.ts`                  |
| RF-08 | CA-01    | 50 consultas por nivel de referencia        | 1..8  | Idéntico siempre                                          | U    | `experience-threshold-reference.spec.ts`     |
| RF-08 | CA-01    | 50 resoluciones por vector de acumulado     | —     | Idéntico siempre                                          | U    | `experience-threshold-reference.spec.ts`     |
| RF-08 | CA-01    | El orden de consulta no altera el resultado | —     | Ascendente y descendente coinciden                        | U    | `experience-threshold-reference.spec.ts`     |
| RF-08 | CA-01    | Detección de cambio accidental de la serie  | 1..8  | El fixture se duplica en cada nivel y crece estrictamente | U    | `experience-threshold-reference.spec.ts`     |
| RF-08 | CA-01    | Detección de cambio de un vector del PO     | —     | Cada vector cae en la banda de su nivel                   | U    | `experience-threshold-reference.spec.ts`     |
| RF-08 | CA-01    | La tabla no se duplica en otro módulo       | —     | Falla si otro archivo reproduce la serie                  | U    | `no-duplicate-experience-thresholds.spec.ts` |
| RF-08 | CA-01    | La serie no se recalcula con una expresión  | —     | Falla ante `Math.pow`, `Math.log` o la base `1,2`         | U    | `no-duplicate-experience-thresholds.spec.ts` |

### Integridad de los datos persistidos

| RF    | CA    | Escenario                                   | Nivel | Resultado esperado                                     | Tipo      | Script                                                                            |
| ----- | ----- | ------------------------------------------- | ----- | ------------------------------------------------------ | --------- | --------------------------------------------------------------------------------- |
| RF-08 | CA-07 | El umbral **no** se persiste                | —     | El motor rechaza un documento con `nextLevelThreshold` | **DB**    | `mongo-hero-progression.spec.ts`                                                  |
| RF-08 | CA-07 | Ida y vuelta documento ↔ instantánea        | 4     | Estable                                                | U         | `hero-progression-mapping.spec.ts`                                                |
| RF-08 | CA-07 | La clave es (jugador, héroe), no el jugador | —     | Dos héroes del mismo jugador son dos documentos        | **DB**    | `mongo-hero-progression.spec.ts`                                                  |
| RF-08 | CA-07 | Creación perezosa sin escribir              | —     | Nivel 1 con 0, sin documento                           | U, **DB** | `get-hero-progression.spec.ts`, `mongo-hero-progression.spec.ts`                  |
| RF-08 | CA-07 | Bloqueo optimista                           | —     | Una escritura gana, la otra da conflicto               | U, **DB** | `in-memory-hero-progression-repository.spec.ts`, `mongo-hero-progression.spec.ts` |
| RF-08 | CA-02 | Nivel incoherente con el acumulado          | —     | `DomainError`; no se sirve un héroe imposible          | U, **DB** | `hero-progression.spec.ts`, `mongo-hero-progression.spec.ts`                      |
| RF-08 | CA-02 | Documento corrupto en la base               | 9     | **Error controlado**, no un umbral inventado           | **DB**    | `mongo-hero-progression.spec.ts`                                                  |

## 5. Valores de referencia: por qué no se copian de la implementación

Es el **primer riesgo** que la Task nombra: «calcular el resultado esperado utilizando exactamente
el mismo código productivo». Si la expectativa se derivara dentro de la prueba, un cambio en la
tabla pasaría inadvertido, porque prueba y código cambiarían juntos.

**Cómo se evita.** Los valores viven en `test/fixtures/experience-threshold-reference.json` y su
origen es el **Product Owner**: son la aclaración funcional posterior al enunciado de la HU `#17`.
No se obtuvieron ejecutando `ExperiencePolicy` ni ninguna otra parte del repositorio, y el campo
`origin` del propio fixture lo deja escrito.

> **Qué cambió respecto de la versión anterior de esta prueba.** Antes el fixture almacenaba la
> serie de `100 × 1,2^(Nivel − 1)` derivada **fuera del repositorio** con aritmética decimal de 50
> dígitos, precisamente para no compartir una sola línea con la política. Con la tabla vigente, la
> referencia ya no es una derivación sino una **decisión del PO**: el valor de la prueba es que
> viene de fuera del código, y ese origen es ahora más fuerte, no más débil. La serie antigua se
> conserva en el campo `supersededFormula` como registro de lo sustituido.

**Controles contra la edición silenciosa.** Si alguien «arreglara» la tabla de referencia para que
la implementación pasara, tendría que romper una propiedad del propio fixture. Cinco pruebas lo
impiden: cubre los ocho niveles sin huecos, el primer umbral es `100`, la serie se duplica en cada
nivel, cada vector de acumulado cae en la banda de su nivel, y cada ejemplo de acreditación respeta
la regla del fixture —todo ello **sin consultar la implementación**.

## 6. Cobertura

Medida con `npm run test:coverage` (umbral global del 80 % configurado en Jest). La Task pide
priorizar la cobertura de la regla, el rango, el nivel máximo, los errores y el contrato de
progresión, y **no** aumentarla con pruebas triviales.

| Archivo                                                                  | Sentencias |      Ramas |  Funciones |
| ------------------------------------------------------------------------ | ---------: | ---------: | ---------: |
| `src/domain/policies/ExperiencePolicy.ts`                                |     97,4 % |     92,9 % |  **100 %** |
| `src/domain/entities/HeroProgression.ts`                                 |  **100 %** |  **100 %** |  **100 %** |
| `src/domain/value-objects/experience.ts`                                 |  **100 %** |  **100 %** |  **100 %** |
| `src/domain/value-objects/hero-level.ts`                                 |       75 % |     64,3 % |  **100 %** |
| `src/application/use-cases/GetHeroProgression.ts`                        |  **100 %** |  **100 %** |  **100 %** |
| `src/application/use-cases/QueryExperienceThreshold.ts`                  |  **100 %** |  **100 %** |  **100 %** |
| `src/adapters/outbound/persistence/hero-progression-mapping.ts`          |  **100 %** |  **100 %** |  **100 %** |
| `src/adapters/outbound/persistence/InMemoryHeroProgressionRepository.ts` |  **100 %** |  **100 %** |  **100 %** |
| **Global del servicio**                                                  | **92,4 %** | **84,0 %** | **90,8 %** |

### Lo que queda sin cubrir, y por qué no se cubre

- **Cinco sentencias de `hero-level.ts`**: las ramas de la función `describe` que formatea un valor
  rechazado en el mensaje de error (`"texto"`, `null`, u otro tipo).
- **Una rama de `ExperiencePolicy.ts`**: la guarda de `thresholdToReach` que lanza si se le pide el
  umbral de un nivel fuera de la tabla. Es **inalcanzable desde fuera** —las dos operaciones
  públicas validan el rango antes de llamarla— y existe como defensa, no como camino.

**No se añaden pruebas para ninguna de las dos.** El punto 7 de la Task prohíbe expresamente
«aumentar cobertura mediante pruebas triviales sin valor funcional», y comprobar cómo se escribe un
mensaje de diagnóstico, o forzar una rama que el propio código hace imposible, no verifica ni la
tabla, ni el rango, ni los límites. Se documenta el hueco en lugar de taparlo con una prueba que
solo sube un número.

## 7. `CA-06` queda fuera, y por qué

`CA-06` —«el nivel del héroe actúa como factor multiplicador sobre el resto de sus estadísticas»—
**no tiene casos de prueba, y es deliberado**.

**El motivo cambió respecto de la primera versión de esta matriz, y hay que decirlo:** antes no
existía fórmula en ninguna fuente. **La aclaración del PO sí la da** (estadística del nivel 1
multiplicada por el nivel actual, con el equipamiento aplicado después). Sigue fuera porque la Task
`#188` enumera entre lo que HU-08 **no** hace «recalcular reglas de combate», exige que no quede
acoplada a batalla o misiones, y porque implementarla tocaría `computeEffectiveStats` (HU-28) y el
contrato interno `equipped-hero` (HU-15), que hoy no lleva nivel.

**Y hay un caso que la aclaración no resuelve:** las estadísticas expresadas como **dados** (el `1d8`
que Combat documenta en su `AttackProfile`) no tienen definida la multiplicación por nivel.
Multiplicar una expresión de dado por un entero no es lo mismo que multiplicar un número, y
decidirlo es del PO. Automatizar una prueba de `CA-06` hoy fijaría un comportamiento que nadie ha
decidido.

**Consecuencia que hay que dejar escrita:** como `CA-08` exige que todo criterio obligatorio
apruebe, **HU-08 no puede aceptarse mientras `CA-06` siga asignado a esta historia**. Requiere
decisión de PO y arquitectura: implementarlo en HU-08, moverlo a otra historia, o reformularlo como
no obligatorio.

## 8. `CA-03` es divergente, y no se prueba como cumplido

`CA-03` sigue enunciando `100 × 1,2^(Nivel − 1)` y el código aplica la tabla vigente. Las dos
series no coinciden más allá del primer valor, y **no es una diferencia de redondeo**: el cociente
entre ellas no es constante (1,667 en el nivel 2, 2,778 en el nivel 3), así que ninguna precisión
convierte una en la otra. La divergencia está medida en `docs/hu-08-progresion.md`, sección 3.

**Qué hace esta suite al respecto, y qué no.**

- **Sí** conserva la serie sustituida en el fixture (`supersededFormula`, con su expresión, su serie
  y el criterio del que sale) y comprueba que la tabla vigente **no** la reproduce. Si alguien
  «reconciliara» las dos series para dar `CA-03` por cumplido sin que el PO lo corrija, esa
  comprobación falla.
- **No** hay ningún caso que declare `CA-03` verificado, porque no lo está. Automatizarlo fijaría
  como correcta una de las dos reglas, y elegir cuál no es de este repositorio.

**Lo que falta:** que el PO **reescriba `CA-03`** para que diga «el umbral se obtiene de la tabla
aprobada `100 · 200 · 400 · 800 · 1.600 · 3.200 · 6.400 · 12.800`». Mientras no se corrija, y por
`CA-08`, la HU no puede declarase aceptada aunque toda la suite esté en verde. No se ha modificado
el Issue.

## 9. Automatización y CI/CD (punto 6 de la Task)

| Requisito                     | Cómo se cumple                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Comando reproducible          | `npm run test:unit`, `npm run test:integration`, `npm run test:db`, `npm run test:coverage`                                                   |
| Sin datos manuales            | Los valores vienen del fixture versionado; la base de datos la levanta Testcontainers                                                         |
| Códigos de salida apropiados  | Jest devuelve distinto de cero si falla una prueba o si la cobertura baja del 80 %                                                            |
| Resultados consumibles por CI | Cobertura en `text-summary`, `lcov`, `json-summary` y `json`; el reporte se publica como artefacto `coverage-player-inventory`                |
| Preparado para `EN-015`       | La verificación ya está cableada en los pasos `Calidad y pruebas` del workflow, que es el contexto de check que exige el ruleset de `develop` |

**Nota sobre `EN-015` y `EN-016`:** ambos están `open` en Management (`#200` y `#201`). Esta Task no
los cierra ni los modifica; se apoya en lo que ya existe. No se añadió ninguna dependencia ni
reportero nuevo salvo `json` en la configuración de cobertura, que es salida estándar de Jest y no
requiere paquete adicional.

## 10. Defectos encontrados

Se registran aquí los hallazgos de la ejecución, según el punto 14 del Enfoque.

### D-1 — La regla estaba expresada con una fórmula que el PO sustituyó (corregido en `#188` y `#189`)

El diseño inicial aplicaba `100 × 1,2^(Nivel − 1)` porque era lo que decía `CA-03`. La aclaración
del PO fijó una tabla de umbrales **acumulados y enteros** que no reproduce esa serie.

| Nivel | `100 × 1,2^(n−1)` | Tabla vigente |
| ----: | ----------------: | ------------: |
|     1 |               100 |           100 |
|     2 |               120 |           200 |
|     3 |               144 |           400 |
|     4 |             172,8 |           800 |
|     5 |            207,36 |         1.600 |
|     6 |           248,832 |         3.200 |
|     7 |          298,5984 |         6.400 |
|     8 |         358,31808 |        12.800 |

**Estado: corregido.** La política aplica la tabla y la suite fija los ocho valores. **Lo que no
está corregido, porque no es de este repositorio, es el enunciado de `CA-03`** (sección 8).

**Un efecto secundario que conviene registrar:** con la fórmula, el diseño tenía que resolver la
representación exacta de `1,2` (`172.79999999999998` frente a `172,8`) con aritmética racional y un
campo `decimal`. Con la tabla, ese problema **desaparece**: no hay fracciones. El campo `decimal` y
la aritmética con `BigInt` se retiraron con la fórmula que los necesitaba.

### D-2 — El umbral podía persistirse por descuido (prevenido en `#189`)

`HeroProgression` no tiene campo de umbral, pero nada impedía que un cambio futuro lo añadiera al
documento. **Estado: prevenido**, no corregido — nunca llegó a ocurrir. El validador de
`008-hero-progressions` lleva `additionalProperties: false`, y una prueba contra MongoDB real
inserta `nextLevelThreshold` a mano y comprueba que **el motor lo rechaza**.

### D-3 — Abierto: `CA-03` divergente bloquea la aceptación de la HU

**No es un defecto de código y no se corrige aquí.** Es un criterio de aceptación obligatorio que
enuncia una regla distinta de la aprobada. Ver la sección 8. **Requiere que el Product Owner
reescriba `CA-03`.**

### D-4 — Abierto: `CA-06` bloquea la aceptación de la HU

**No es un defecto de código.** El PO ya dio la fórmula, pero no está implementada, no es de esta
historia y no cubre las estadísticas expresadas como dados. Ver la sección 7. **Requiere decisión
de Product Owner y arquitectura.**

### D-5 — La migración `007` chocaba con la de HU-65 (corregido al integrar con `develop`)

Mientras HU-08 se desarrollaba, HU-65 entró en `develop` ocupando el número `007`
(`007-auction-commitments`). La migración de la progresión se había escrito como `007-hero-progressions`,
así que al integrar habría quedado **duplicado el número** de la séptima migración.

**Estado: corregido.** La migración de HU-08 es `008-hero-progressions` y se registra en
`MIGRATIONS` **después** de la de HU-65. El orden importa aunque el registro `_migrations` se lleve
por nombre: la numeración es la que hace legible en qué orden se construyó el esquema, y dos
migraciones con el mismo número lo vuelven ambiguo para quien las revise o las reejecute sobre una
base limpia. Ninguna prueba lo habría detectado —las dos son válidas por separado—, así que el
hallazgo se registra aquí.

## 11. Reporte de ejecución

El reporte completo —versión, ambiente, casos, cobertura, defectos y observaciones para
aceptación— vive en la evidencia de Infrastructure, siguiendo el patrón con el que HU-07 y HU-39
documentaron la suya:

`Nexus-Battle-Infrastructure/docs/evidence/HU-08-calculo-de-experiencia-requerida-por-nivel.md`

Cifras de la última ejecución local (Node 24.19.0):

| Suite                            | Suites | Casos | Resultado                                           |
| -------------------------------- | -----: | ----: | --------------------------------------------------- |
| Unitarias (`test:unit`)          |     32 |   697 | En verde                                            |
| Integración (`test:integration`) |     10 |   105 | En verde                                            |
| MongoDB real (`test:db`)         |      8 |    80 | Requiere contenedor; la ejecuta el CI               |
| Cobertura (`test:coverage`)      |     42 |   802 | 92,4 % sentencias · 84,0 % ramas · 90,8 % funciones |

De los casos anteriores, **pertenecen a HU-08**: 109 unitarios y 12 contra MongoDB real.
