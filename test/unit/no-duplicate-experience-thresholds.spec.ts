import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Control de duplicacion de la tabla de umbrales (HU-08, Task #189).
 *
 * La Task lo exige en dos sitios: "La implementacion no debe quedar duplicada en
 * HU-09, HU-10 ni en otros modulos" y "La formula no debe aparecer repetida como
 * expresion literal en multiples capas". Afirmarlo en un comentario no basta:
 * esta prueba FALLA si alguien reproduce la tabla fuera de `ExperiencePolicy`,
 * que es el mismo criterio con el que HU-07 probo su "noveno heroe".
 *
 * QUE CAMBIO RESPECTO DE LA VERSION ANTERIOR, Y POR QUE. Antes el control
 * buscaba la formula `100 x 1,2^(n - 1)` y tenia que excluir de su propio
 * barrido el archivo de la politica, porque la politica citaba la formula en un
 * comentario. El Product Owner sustituyo la formula por una tabla de ocho
 * enteros, asi que el control cambio de objeto: ahora vigila que la TABLA no se
 * copie.
 *
 * COMO SE DISTINGUE UNA TABLA DE UN USO SUELTO. Contar apariciones de un valor
 * no sirve: `400` puede ser un numero legitimo en cualquier archivo. Lo que
 * delata una segunda tabla es la COINCIDENCIA de varios valores de la serie en
 * el mismo archivo, asi que el umbral es "cuatro o mas de los ocho". Se ignoran
 * ademas las lineas de comentario, para que explicar la tabla no cuente como
 * duplicarla.
 *
 * Es el mismo problema que ya resolvieron las guardas de aleatoriedad de Combat,
 * que enumeran a mano los archivos vigilados para no marcarse a si mismas.
 */

const SRC = join(__dirname, '..', '..', 'src')

/** La politica es el UNICO sitio donde la tabla puede estar escrita. */
const OWNER = 'ExperiencePolicy.ts'

/** Los ocho valores aprobados por el Product Owner, en orden de nivel. */
const THRESHOLD_VALUES: readonly number[] = [100, 200, 400, 800, 1600, 3200, 6400, 12800]

/**
 * Cuantos valores de la serie aparecen en el mismo archivo hacen falta para
 * considerar que alli hay una segunda tabla. Cuatro es holgadamente mas de lo que
 * produce un uso casual y muy por debajo de los ocho de la tabla real.
 */
const MIN_VALUES_TO_BE_A_TABLE = 4

/**
 * Formas COMPUTADAS de la misma regla. Una tabla escrita como expresion
 * (`100 * 2 ** (nivel - 1)`) no se detectaria contando literales, y la base
 * `1,2` de la formula que el PO sustituyo tampoco debe reaparecer.
 */
const COMPUTED_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'Math.pow', pattern: /Math\s*\.\s*pow/ },
  { name: 'Math.log', pattern: /Math\s*\.\s*log/ },
  { name: 'la base 1.2 de la formula sustituida', pattern: /\b1\.2\b/ },
  { name: 'la base 1,2 con coma', pattern: /\b1,2\b/ },
]

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry)

    if (statSync(full).isDirectory()) return sourceFiles(full)
    return entry.endsWith('.ts') ? [full] : []
  })

/**
 * Quita las lineas de comentario, para no confundir una mencion con una
 * evaluacion. Reconoce los tres inicios posibles: doble barra, apertura de
 * bloque y continuacion de bloque.
 */
const codeOf = (source: string): string =>
  source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()

      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    })
    .join('\n')

/** Cuantos de los ocho valores aprobados aparecen como literal en el codigo. */
const countThresholdLiterals = (code: string): number =>
  THRESHOLD_VALUES.filter((value) => new RegExp(`\\b${String(value)}\\b`).test(code)).length

describe('HU-08 — la tabla del umbral vive en un unico punto', () => {
  const files = sourceFiles(SRC)

  it('encuentra los fuentes del servicio (si no, la prueba no vigila nada)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.endsWith(OWNER))).toBe(true)
  })

  it('ningun archivo fuera de ExperiencePolicy reproduce la tabla', () => {
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(OWNER)) continue

      const code = codeOf(readFileSync(file, 'utf8'))
      const found = countThresholdLiterals(code)

      if (found >= MIN_VALUES_TO_BE_A_TABLE) {
        offenders.push(`${file.replace(SRC, 'src')} -> ${String(found)} de los 8 valores`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('ningun archivo fuera de ExperiencePolicy calcula la serie con una expresion', () => {
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(OWNER)) continue

      const code = codeOf(readFileSync(file, 'utf8'))

      for (const { name, pattern } of COMPUTED_PATTERNS) {
        if (pattern.test(code)) {
          offenders.push(`${file.replace(SRC, 'src')} -> ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('la propia politica si contiene la tabla, para que el control no sea vacio', () => {
    // Si alguien moviera la tabla a otro archivo renombrando este, las dos
    // pruebas anteriores pasarian por vacias. Esto lo impide.
    const owner = files.find((file) => file.endsWith(OWNER))

    expect(owner).toBeDefined()

    const code = codeOf(readFileSync(owner ?? '', 'utf8'))

    for (const value of THRESHOLD_VALUES) {
      expect(code).toMatch(new RegExp(`\\b${String(value)}\\b`))
    }
  })

  it('el umbral de "cuatro o mas" no es un colador: un archivo con la tabla entera se detecta', () => {
    // Comprobacion del propio control, para que no pueda quedarse en verde por
    // estar mal calibrado.
    const tablaCopiada = 'const copia = [100, 200, 400, 800, 1600, 3200, 6400, 12800]'

    expect(countThresholdLiterals(tablaCopiada)).toBeGreaterThanOrEqual(MIN_VALUES_TO_BE_A_TABLE)
  })
})
