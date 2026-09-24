# Fixtures de prueba

Datos de prueba **compartidos por varias suites** de este repositorio. No son código de
producción y no los importa nada de `src/`.

## `experience-threshold-reference.json`

Tabla de umbrales de experiencia por nivel de HU-08 (RF-08), para la prueba de regresión
`test/unit/experience-threshold-reference.spec.ts`.

**Por qué es un archivo y no un literal en la prueba.** La Task `#190` nombra como primer riesgo
«calcular el resultado esperado utilizando exactamente el mismo código productivo». Si la
expectativa se derivara dentro de la prueba, un cambio en la tabla pasaría inadvertido, porque
prueba y código cambiarían juntos.

**De dónde salen los valores.** Del **Product Owner**, y de ningún sitio más: son la aclaración
funcional posterior al enunciado original de la HU `#17`. Los ocho umbrales acumulados
(`100 · 200 · 400 · 800 · 1.600 · 3.200 · 6.400 · 12.800`), los vectores de nivel (`749 → 3`,
`849 → 4`, `890 → 4`, `3.500 → 6`, `13.000 → 8`, `13.500 → 8`) y los tres ejemplos de acreditación
salieron todos de esa aclaración. **Ninguno se obtuvo ejecutando `ExperiencePolicy`** ni ninguna
otra parte del repositorio, y el campo `origin` del propio JSON lo deja escrito.

**Qué sustituye, y por qué cambió esta prueba.** La versión anterior almaceaba la serie de la
fórmula `100 × 1,2^(Nivel − 1)` —`100 · 120 · 144 · 172,8 · 207,36 · 248,832 · 298,5984`— derivada
fuera del repositorio con aritmética decimal de 50 dígitos. Esa fórmula **ya no gobierna el
cálculo**: el PO la sustituyó por la tabla, y las dos series no coinciden más allá del primer
valor. La serie antigua se conserva aquí solo como registro de lo sustituido, en el campo
`supersededFormula`, para que la divergencia de `CA-03` sea rastreable.

**Procedencia verificable.** El campo `origin` del JSON y una prueba que comprueba que exista:
nadie debe poder tomar la tabla por calculada dentro del repositorio.

**Control contra la edición silenciosa.** Si alguien «arreglara» la tabla de referencia para que
la implementación pasara, tendría que romper alguna propiedad del propio fixture. Tres lo
impiden: cubre los ocho niveles sin huecos, el primer umbral es `100` y la serie crece
estrictamente duplicándose.

**Si hay que regenerarla.** Solo si el Product Owner cambia la regla, y entonces la decisión es
funcional y debe estar aprobada y registrada. Regenerarla para que una prueba pase invierte el
sentido del control: la tabla es la especificación, no un espejo de la implementación.
