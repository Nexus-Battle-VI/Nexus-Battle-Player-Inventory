import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guarda estatica de HU-71: la resolucion de las habilidades de un heroe contra
 * Catalog existe UNA vez.
 *
 * POR QUE. `equipped-hero` (Combat) y `heroes/{heroId}` (Missions, HU-71)
 * publican las mismas habilidades con la misma forma, y la regla tiene tres
 * partes que se pueden equivocar de tres maneras distintas: que el `lookup` sea
 * uno solo y no uno por habilidad, que la habilidad que no cumple el contrato
 * canonico se omita en vez de inventarse, y que el fallo de Catalog se propague
 * en lugar de devolver una lista vacia. Con dos copias, la segunda ruta empezaria
 * a divergir sin que ninguna prueba lo dijera.
 *
 * Se comprueba sobre el CODIGO FUENTE, no sobre el comportamiento: es la unica
 * forma de que anadir una tercera implementacion falle en CI.
 */
const ROOT = join(__dirname, '..', '..', 'src')
const SHARED = 'application/use-cases/hero-profile-shared.ts'

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })

const relative = (file: string): string => file.slice(ROOT.length + 1).replaceAll('\\', '/')

const codeOf = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const ALL_SOURCES = sourceFiles(ROOT)
const CONSUMERS = [
  'application/use-cases/GetEquippedHeroForCombat.ts',
  'application/use-cases/GetHeroProfileForMission.ts',
]

describe('la resolucion de habilidades de un heroe vive en un solo sitio', () => {
  it('solo el modulo compartido interpreta los atributos de una HABILIDAD', () => {
    const files = ALL_SOURCES.filter((file) =>
      /import[^;]*parseAbilityAttributes/.test(codeOf(file)),
    ).map(relative)

    expect(files).toEqual([SHARED])
  })

  it('solo el modulo compartido declara el tipo canonico de Catalog de una habilidad', () => {
    const files = ALL_SOURCES.filter((file) => /const ABILITY_TYPE\s*=/.test(codeOf(file))).map(
      relative,
    )

    expect(files).toEqual([SHARED])
  })

  it.each(CONSUMERS)(
    '%s usa el modulo compartido y no resuelve habilidades por su cuenta',
    (file) => {
      const code = codeOf(join(ROOT, file))

      expect(code).toMatch(/from '\.\/hero-profile-shared'/)
      expect(code).toMatch(/resolveHeroAbilities/)
      expect(code).not.toMatch(/parseAbilityAttributes/)
      expect(code).not.toMatch(/ABILITY_TYPE/)
    },
  )

  it('los dos consumidores existen: si se renombra uno, esta guarda lo dice', () => {
    const present = ALL_SOURCES.map(relative)

    for (const consumer of CONSUMERS) {
      expect(present).toContain(consumer)
    }
  })
})
