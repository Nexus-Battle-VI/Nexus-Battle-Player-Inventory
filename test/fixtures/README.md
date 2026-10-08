# Fixtures de prueba

Datos de prueba **compartidos por varias suites** de este repositorio. No son código de
producción y no los importa nada de `src/`.

## `tournament-prize.ts`

Dataset `QA-HU86-INVENTORY-v1`: héroe/épica canónicos controlados, destinatario,
torneo/final/sala sintéticos explícitos. Se usa en validación, HTTP y Mongo real;
no define reparto, exclusividad global ni campeón operativo. La prueba entre
servicios crea un dataset aislado con el caso de uso real de Catálogo y sus
validaciones; ese dataset separado exige las tres habilidades del héroe.

## `experience-threshold-reference.json`

Tabla de umbrales de experiencia por nivel de HU-08 (RF-08), para la prueba de regresión
`test/unit/experience-threshold-reference.spec.ts`.

**Por qué es un archivo y no un literal en la prueba.** La Task `#190` nombra como primer riesgo
«calcular el resultado esperado utilizando exactamente el mismo código productivo». Si la
expectativa se derivara dentro de la prueba, un cambio en la tabla pasaría inadvertido, porque
prueba y código cambiarían juntos.

**De dónde salen los valores.** Del **Product Owner**, y de ningún sitio más: son la decisión
funcional posterior al enunciado original de la HU `#17`. Los siete umbrales acumulados
(`100 · 300 · 500 · 700 · 900 · 1.100 · 1.300`, para pasar de nivel), las fronteras de nivel
(`99 → 1`, `100 → 2`, … `1.299 → 7`, `1.300 → 8`) y los ejemplos de acreditación (`99 + 1`, `90 + 430`,
`1.299 + 1`, `1.300 + 5.000`) salieron todos de esa decisión. **Ninguno se obtuvo ejecutando
`ExperiencePolicy`** ni ninguna otra parte del repositorio, y el campo `origin` del propio JSON lo
deja escrito. La fórmula original y la tabla temporal anterior quedan registradas como
**sustituidas** (`supersededFormula`, `supersededTable`).

**Qué sustituye, y por qué cambió esta prueba.** La versión anterior almaceaba la serie de la
fórmula `100 × 1,2^(Nivel − 1)` —`100 · 120 · 144 · 172,8 · 207,36 · 248,832 · 298,5984`— derivada
fuera del repositorio con aritmética decimal de 50 dígitos. Esa fórmula **ya no gobierna el
cálculo**: el PO la sustituyó por la tabla, y las dos series no coinciden más allá del primer
valor. La serie antigua se conserva aquí solo como registro de lo sustituido, en el campo
`supersededFormula`, para que la divergencia de `CA-03` sea rastreable.

**Procedencia verificable.** El campo `origin` del JSON y una prueba que comprueba que exista:
nadie debe poder tomar la tabla por calculada dentro del repositorio.

**Control contra la edición silenciosa.** Si alguien «arreglara» la tabla de referencia para que
la implementación pasara, tendría que romper alguna propiedad del propio fixture. Lo
impiden: cubre los siete pasos de nivel sin huecos, el primer umbral es `100` y la serie crece
estrictamente de 200 en 200.

**Si hay que regenerarla.** Solo si el Product Owner cambia la regla, y entonces la decisión es
funcional y debe estar aprobada y registrada. Regenerarla para que una prueba pase invierte el
sentido del control: la tabla es la especificación, no un espejo de la implementación.
