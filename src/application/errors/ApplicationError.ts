/**
 * Errores de la capa de aplicacion. Describen el resultado del caso de uso sin
 * conocer el protocolo: la traduccion a HTTP ocurre en el adaptador de entrada.
 */
export class InventoryNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`El jugador "${ownerId}" no tiene un inventario registrado.`)
    this.name = 'InventoryNotFoundError'
  }
}

/**
 * El jugador no posee esa referencia, o Catalog no conoce el producto que
 * posee. Se traduce a 404 en ambos casos: distinguirlos filtraria si el
 * producto existe en el catalogo de otra persona.
 */
export class InventoryItemNotFoundError extends Error {
  constructor(itemReference: string) {
    super(`El jugador no posee el producto "${itemReference}".`)
    this.name = 'InventoryItemNotFoundError'
  }
}

/**
 * El heroe no pertenece al jugador autenticado, no existe, o la referencia no
 * corresponde a un producto de tipo HEROE. Se traduce a 404 en todos los casos
 * por la misma politica anti-enumeracion que el resto del servicio: distinguir
 * los casos revelaria que ese heroe existe en el inventario de otra persona.
 */
export class HeroNotOwnedError extends Error {
  constructor(heroReference: string) {
    super(`El jugador no dispone del heroe "${heroReference}".`)
    this.name = 'HeroNotOwnedError'
  }
}

/**
 * El producto a equipar no esta en el inventario del jugador, o Catalog no lo
 * conoce. 404 por anti-enumeracion, igual que la ficha de HU-27.
 */
export class EquipmentProductNotOwnedError extends Error {
  constructor(productReference: string) {
    super(`El jugador no posee el producto "${productReference}".`)
    this.name = 'EquipmentProductNotOwnedError'
  }
}

/**
 * La referencia SI es un producto poseido, pero su tipo canonico no es
 * equipable en HU-28 (no es ARMA, ARMADURA ni ITEM). Es un dato valido con una
 * regla incumplida: 422.
 */
export class InvalidEquipmentTypeError extends Error {
  constructor(productReference: string, productType: string) {
    super(
      `El producto "${productReference}" es de tipo ${productType} y no se puede equipar en un heroe.`,
    )
    this.name = 'InvalidEquipmentTypeError'
  }
}

/**
 * El producto es una pieza de armadura, pero su ranura canonica no coincide con
 * la ranura solicitada (p. ej. un peto en la ranura del casco). 422.
 */
export class EquipmentSlotMismatchError extends Error {
  constructor(slot: string, expectedArmorSlot: string, actualArmorSlot: string | null) {
    super(
      `La ranura ${slot} espera una pieza de tipo ${expectedArmorSlot}; el producto es de tipo ${actualArmorSlot ?? 'desconocido'}.`,
    )
    this.name = 'EquipmentSlotMismatchError'
  }
}

/**
 * Otra escritura modifico el loadout entre la lectura y el guardado (bloqueo
 * optimista). 409: la peticion es correcta y puede reintentarse.
 */
export class HeroLoadoutConflictError extends Error {
  constructor(heroId: string) {
    super(`El equipamiento del heroe ${heroId} cambio durante la operacion. Reintentelo.`)
    this.name = 'HeroLoadoutConflictError'
  }
}

/**
 * El jugador todavia no ha preparado ningun heroe (HU-07). 404: no hay recurso
 * que devolver, y no es un error del cliente ni del servicio.
 */
export class NoHeroSelectedError extends Error {
  constructor() {
    super('Todavia no has preparado ningun heroe.')
    this.name = 'NoHeroSelectedError'
  }
}

/**
 * El heroe SI pertenece al jugador, pero no esta activo en el catalogo vigente
 * (HU-07, CA-11). Es un dato valido con una regla incumplida: 409, y con un
 * mensaje que distingue "no lo tienes" de "ya no esta disponible" —confundirlos
 * mandaria al jugador a buscar en el sitio equivocado—.
 */
export class HeroNotSelectableError extends Error {
  constructor(heroReference: string) {
    super(`El heroe "${heroReference}" no esta disponible en el catalogo vigente.`)
    this.name = 'HeroNotSelectableError'
  }
}

/**
 * Otra peticion cambio la seleccion entre la lectura y el guardado (bloqueo
 * optimista). 409: la peticion es correcta y puede reintentarse.
 */
export class HeroSelectionConflictError extends Error {
  constructor(ownerId: string) {
    super(`La seleccion de heroe de ${ownerId} cambio durante la operacion. Reintentelo.`)
    this.name = 'HeroSelectionConflictError'
  }
}

/**
 * Otra escritura modifico la progresion del heroe entre la lectura y el guardado
 * (bloqueo optimista). 409: la peticion es correcta y puede reintentarse.
 *
 * Existe aunque HU-08 no acredite experiencia por si misma: el bloqueo optimista
 * es lo que impedira que dos recompensas simultaneas acrediten experiencia dos
 * veces sobre el mismo estado, y HU-09 lo necesita ya definido. Sin el, la segunda
 * escritura sumaria sobre un valor superado.
 */
export class HeroProgressionConflictError extends Error {
  constructor(heroId: string) {
    super(`La progresion del heroe ${heroId} cambio durante la operacion. Reintentelo.`)
    this.name = 'HeroProgressionConflictError'
  }
}

/**
 * El mismo `operationId` de acreditacion llego con OTRO contenido (HU-09, Task
 * HU-09.3). 409: la peticion es correcta pero no puede aplicarse.
 *
 * La clave de una acreditacion es determinista
 * (`mission:{enrollmentId}:encounter:{encounterId}:enemy:{enemyInstanceId}:hero:{heroId}:xp`),
 * asi que esto no deberia ocurrir en operacion normal: si ocurre es una anomalia
 * --colision de datos o un defecto del llamante-- y reintentar con el mismo
 * cuerpo no la resuelve. NUNCA se sobrescribe el asiento del ledger: devolver
 * otro resultado por una acreditacion ya hecha seria regalar dos veces la misma
 * recompensa.
 */
export class ExperienceGrantConflictError extends Error {
  constructor(operationId: string) {
    super(`La operacion "${operationId}" ya existe con otros datos.`)
    this.name = 'ExperienceGrantConflictError'
  }
}

/**
 * La acreditacion no se puede aplicar: importe no entero o negativo, o heroe no
 * acreditable (HU-09, Task HU-09.3). 422: el dato es valido como peticion pero
 * incumple una regla, y reintentarlo tal cual no cambia el resultado.
 *
 * NO se redondea nada aqui. El importe lo calcula y lo redondea Missions: si
 * llega fraccionario, el error es de la frontera y se dice, en lugar de
 * acreditar una cantidad que nadie pidio.
 */
export class ExperienceGrantRejectedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ExperienceGrantRejectedError'
  }
}
