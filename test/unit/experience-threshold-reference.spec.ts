import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HeroProgression } from '../../src/domain/entities/HeroProgression'
import {
  LEVEL_UP_THRESHOLDS,
  MAX_HERO_LEVEL,
  MIN_HERO_LEVEL,
  experienceRequiredForNextLevel,
  levelFromTotalXp,
} from '../../src/domain/policies/ExperiencePolicy'

/**
 * Regresion de la tabla contra VALORES DE REFERENCIA INDEPENDIENTES
 * (HU-08, Task #190).
 *
 * EL RIESGO QUE ESTA SUITE CIERRA. La Task lo nombra primero: "calcular el
 * resultado esperado utilizando exactamente el mismo codigo productivo". Si la
 * expectativa se escribiera aqui dentro --o peor, se derivara de la propia
 * politica-- un cambio en la tabla pasaria inadvertido: la prueba y el codigo
 * cambiarian juntos.
 *
 * Por eso los valores NO viven en este archivo ni se calculan aqui. Viven en
 * `test/fixtures/experience-threshold-reference.json` y su origen es el Product
 * Owner: son la aclaracion funcional posterior al enunciado de la HU #17. No se
 * obtuvieron ejecutando `ExperiencePolicy`. La procedencia exacta esta en el
 * campo `origin` del fixture.
 *
 * La suite comprueba por tanto tres cosas distintas:
 *   1. que la tabla de referencia sea internamente coherente (si alguien la edita
 *      a mano para que la prueba pase, esto lo delata);
 *   2. que la implementacion coincida con ella, nivel a nivel, en las dos
 *      direcciones y en los tres ejemplos de acreditacion;
 *   3. que la formula sustituida siga registrada y NO reproduzca la tabla, para
 *      que la divergencia de CA-03 no se pueda dar por resuelta sola.
 */

interface ReferenceThreshold {
  readonly fromLevel: number
  readonly toLevel: number
  readonly amount: number
}

interface ReferenceLevel {
  readonly totalXp: number
  readonly level: number
}

interface ReferenceAward {
  readonly from: ReferenceLevel
  readonly amount: number
  readonly to: ReferenceLevel
  readonly note: string
}

interface ReferenceSupersededFormula {
  readonly expression: string
  readonly series: readonly number[]
  readonly where: string
  readonly note: string
}

interface ReferenceTable {
  readonly schemaVersion: string
  readonly origin: string
  readonly semantics: string
  readonly supersededFormula: ReferenceSupersededFormula
  readonly supersededTable: { readonly series: readonly number[]; readonly where: string }
  readonly maxLevel: number
  readonly thresholds: readonly ReferenceThreshold[]
  readonly levels: readonly ReferenceLevel[]
  readonly awards: readonly ReferenceAward[]
}

const loadReference = (): ReferenceTable =>
  JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'experience-threshold-reference.json'), 'utf8'),
  ) as ReferenceTable

/** Experiencia acumulada que la referencia exige para PASAR de `level` al siguiente. */
const thresholdOf = (reference: ReferenceTable, level: number): number =>
  reference.thresholds[level - MIN_HERO_LEVEL]?.amount ?? -1

/** Nivel que la referencia asigna a un acumulado: 1 + umbrales alcanzados. */
const referenceLevelOf = (reference: ReferenceTable, totalXp: number): number =>
  MIN_HERO_LEVEL + reference.thresholds.filter((entry) => totalXp >= entry.amount).length

describe('HU-08 — regresion contra valores de referencia', () => {
  const reference = loadReference()

  describe('la tabla de referencia es utilizable', () => {
    it('cubre los siete pasos de nivel (1->2 ... 7->8), sin huecos', () => {
      const expectedFrom = Array.from(
        { length: MAX_HERO_LEVEL - MIN_HERO_LEVEL },
        (_, index) => MIN_HERO_LEVEL + index,
      )

      expect(reference.thresholds.map((entry) => entry.fromLevel)).toEqual(expectedFrom)
      expect(reference.thresholds.map((entry) => entry.toLevel)).toEqual(
        expectedFrom.map((level) => level + 1),
      )
      expect(reference.maxLevel).toBe(MAX_HERO_LEVEL)
    })

    it('declara su procedencia, para que nadie la tome por calculada aqui', () => {
      expect(reference.origin).toContain('Product Owner')
      expect(reference.origin).toContain('ExperiencePolicy')
      expect(reference.origin.length).toBeGreaterThan(40)
      expect(reference.semantics).toContain('ACUMULADA')
    })

    /**
     * Si alguien "arregla" la tabla para que la implementacion pase, tiene que
     * romper una propiedad de la propia tabla. Estas tres la fijan.
     */
    it('el primer umbral es 100 y los siguientes crecen de 200 en 200', () => {
      expect(thresholdOf(reference, 1)).toBe(100)

      for (let level = MIN_HERO_LEVEL + 1; level < MAX_HERO_LEVEL; level += 1) {
        expect(thresholdOf(reference, level) - thresholdOf(reference, level - 1)).toBe(200)
      }
    })

    it('los siete umbrales son enteros y crecen estrictamente', () => {
      for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
        const current = thresholdOf(reference, level)

        expect(Number.isInteger(current)).toBe(true)

        if (level > MIN_HERO_LEVEL) {
          expect(current).toBeGreaterThan(thresholdOf(reference, level - 1))
        }
      }
    })

    it('los vectores de nivel son coherentes con los umbrales del propio fixture', () => {
      // Comprobacion interna: cada vector tiene que caer en la banda de su nivel
      // segun la tabla de referencia. Si alguien cambiara un vector a mano para
      // tapar un fallo, esto lo delata sin consultar la implementacion.
      for (const entry of reference.levels) {
        expect(entry.level).toBe(referenceLevelOf(reference, entry.totalXp))
      }
    })

    it('los ejemplos de acreditacion respetan la regla del propio fixture', () => {
      for (const award of reference.awards) {
        const total = award.from.totalXp + award.amount
        expect(award.to.totalXp).toBe(total)
        expect(award.to.level).toBe(referenceLevelOf(reference, total))
        expect(award.note.length).toBeGreaterThan(20)
      }
    })
  })

  describe('la implementacion coincide con la referencia', () => {
    it('la tabla de la politica es, valor a valor, la de la referencia', () => {
      expect([...LEVEL_UP_THRESHOLDS]).toEqual(reference.thresholds.map((entry) => entry.amount))
    })

    it('el umbral de cada nivel es el de la referencia, nivel a nivel', () => {
      for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
        expect(experienceRequiredForNextLevel(level)).toEqual({
          status: 'AVAILABLE',
          forNextLevel: level + 1,
          amount: thresholdOf(reference, level),
        })
      }
    })

    it('el nivel maximo no produce umbral ni un nivel 9', () => {
      expect(experienceRequiredForNextLevel(MAX_HERO_LEVEL)).toEqual({
        status: 'MAX_LEVEL',
        currentLevel: MAX_HERO_LEVEL,
        forNextLevel: null,
        amount: null,
      })
    })

    it('cada vector de acumulado produce el nivel de la referencia', () => {
      for (const entry of reference.levels) {
        expect(levelFromTotalXp(entry.totalXp)).toBe(entry.level)
      }
    })

    it('cada ejemplo de acreditacion deja el acumulado y el nivel de la referencia', () => {
      for (const award of reference.awards) {
        const after = HeroProgression.restore({
          ownerId: 'jugador-de-referencia',
          heroId: 'heroe-de-referencia',
          level: award.from.level,
          currentXp: award.from.totalXp,
          version: 0,
        }).awardExperience(award.amount)

        expect(after.experience.currentXp).toBe(award.to.totalXp)
        expect(after.level.value).toBe(award.to.level)
      }
    })
  })

  describe('la formula sustituida sigue registrada, y no reproduce la tabla', () => {
    it('el fixture conserva la serie de CA-03 tal como estaba enunciada', () => {
      expect(reference.supersededFormula.expression).toContain('1,2')
      expect([...reference.supersededFormula.series]).toEqual([
        100, 120, 144, 172.8, 207.36, 248.832, 298.5984,
      ])
      expect(reference.supersededFormula.where).toContain('CA-03')
    })

    it('la serie sustituida NO es la tabla vigente: la divergencia es real', () => {
      // Si alguien "reconciliara" las dos series para dar CA-03 por cumplido sin
      // que el PO lo corrija, esta comprobacion falla.
      const superseded = reference.supersededFormula.series
      const approved = reference.thresholds.map((entry) => entry.amount)

      expect(approved).not.toEqual([...superseded])
      expect(approved[1]).not.toBe(superseded[1])
      expect(reference.supersededFormula.note).toContain('redondeo')
    })

    it('la tabla temporal anterior tambien queda registrada como sustituida', () => {
      const approved = reference.thresholds.map((entry) => entry.amount)

      expect([...reference.supersededTable.series]).toEqual([
        100, 200, 400, 800, 1600, 3200, 6400, 12800,
      ])
      expect(approved).not.toEqual([...reference.supersededTable.series])
    })
  })

  describe('determinismo: la misma entrada da el mismo resultado', () => {
    it('consultar 50 veces cada nivel de referencia produce siempre lo mismo', () => {
      for (const entry of reference.thresholds) {
        const first = JSON.stringify(experienceRequiredForNextLevel(entry.fromLevel))

        for (let attempt = 0; attempt < 50; attempt += 1) {
          expect(JSON.stringify(experienceRequiredForNextLevel(entry.fromLevel))).toBe(first)
        }
      }
    })

    it('resolver el nivel 50 veces por vector produce siempre lo mismo', () => {
      for (const entry of reference.levels) {
        const first = levelFromTotalXp(entry.totalXp)

        for (let attempt = 0; attempt < 50; attempt += 1) {
          expect(levelFromTotalXp(entry.totalXp)).toBe(first)
        }
      }
    })

    it('el resultado no depende del orden en que se consulte', () => {
      const ascending = reference.levels.map((entry) => levelFromTotalXp(entry.totalXp))
      const descending = [...reference.levels]
        .reverse()
        .map((entry) => levelFromTotalXp(entry.totalXp))
        .reverse()

      expect(descending).toEqual(ascending)
    })

    it('no modifica los valores consultados', () => {
      for (const entry of reference.thresholds) {
        const level = entry.fromLevel

        experienceRequiredForNextLevel(level)
        experienceRequiredForNextLevel(level)

        expect(level).toBe(entry.fromLevel)
      }
    })
  })

  describe('las constantes del contrato no cambian por accidente', () => {
    it('el rango sigue siendo 1..8', () => {
      expect(MIN_HERO_LEVEL).toBe(1)
      expect(MAX_HERO_LEVEL).toBe(8)
      expect(reference.maxLevel).toBe(MAX_HERO_LEVEL)
      expect(reference.thresholds).toHaveLength(MAX_HERO_LEVEL - MIN_HERO_LEVEL)
    })
  })
})
