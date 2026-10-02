/**
 * Ready-to-read texts per language, so a first-time user can press Record right away.
 * All are in the public domain (published before 1929) or written for this app.
 */

/** @type {Readonly<Record<string, {id: string, title: string, text: string}[]>>} */
export const SAMPLES = Object.freeze({
  "en-US": [
    {
      id: "north-wind",
      title: "The North Wind and the Sun (Aesop's fable)",
      text:
        "The North Wind and the Sun were arguing about which of them was stronger, when a traveler came along wrapped in a warm cloak. " +
        "They agreed that whoever first made the traveler take off his cloak would be the stronger one. " +
        "The North Wind blew as hard as he could, but the harder he blew, the more tightly the traveler held his cloak around him, and at last the North Wind gave up. " +
        "Then the Sun shone out warmly, and the traveler took off his cloak at once. " +
        "So the North Wind had to admit that the Sun was the stronger of the two.",
    },
    {
      id: "two-cities",
      title: "A Tale of Two Cities (Charles Dickens, 1859)",
      text:
        "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, " +
        "it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, " +
        "it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, " +
        "we were all going direct to Heaven, we were all going direct the other way.",
    },
    {
      id: "gettysburg",
      title: "The Gettysburg Address (Abraham Lincoln, 1863)",
      text:
        "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, " +
        "and dedicated to the proposition that all men are created equal. " +
        "Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. " +
        "We are met on a great battlefield of that war. " +
        "We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. " +
        "It is altogether fitting and proper that we should do this.",
    },
    {
      id: "road-not-taken",
      title: "The Road Not Taken (Robert Frost, 1916)",
      text:
        "Two roads diverged in a yellow wood,\nAnd sorry I could not travel both\nAnd be one traveler, long I stood\n" +
        "And looked down one as far as I could\nTo where it bent in the undergrowth;\n\n" +
        "I shall be telling this with a sigh\nSomewhere ages and ages hence:\nTwo roads diverged in a wood, and I,\n" +
        "I took the one less traveled by,\nAnd that has made all the difference.",
    },
    {
      id: "bakery",
      title: "A morning walk",
      text:
        "Every morning I walk to the small bakery at the end of our street. The owner, a quiet man with flour on his sleeves, " +
        "always asks whether I want the usual. I nod, and he wraps a warm loaf of rye bread in brown paper. " +
        "On the way back I pass the old library, where a few students are already waiting for the doors to open.",
    },
  ],
  "es-ES": [
    {
      id: "viento-norte",
      title: "El viento del norte y el sol (fábula de Esopo)",
      text:
        "El viento del norte y el sol discutían sobre cuál de los dos era más fuerte, cuando pasó un viajero envuelto en una capa. " +
        "Acordaron que el primero que lograra quitarle la capa al viajero sería el más fuerte. " +
        "El viento del norte sopló con todas sus fuerzas, pero cuanto más soplaba, más se abrigaba el viajero con su capa, y al final el viento se rindió. " +
        "Entonces el sol brilló con calor, y el viajero se quitó la capa enseguida. " +
        "Así el viento del norte tuvo que reconocer que el sol era el más fuerte de los dos.",
    },
    {
      id: "quijote",
      title: "Don Quijote de la Mancha (Miguel de Cervantes, 1605)",
      text:
        "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, " +
        "adarga antigua, rocín flaco y galgo corredor. " +
        "Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, " +
        "algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.",
    },
    {
      id: "caminante",
      title: "Caminante, no hay camino (Antonio Machado, 1912)",
      text:
        "Caminante, son tus huellas\nel camino y nada más;\ncaminante, no hay camino,\nse hace camino al andar.\n" +
        "Al andar se hace camino,\ny al volver la vista atrás\nse ve la senda que nunca\nse ha de volver a pisar.\n" +
        "Caminante, no hay camino,\nsino estelas en la mar.",
    },
    {
      id: "panaderia",
      title: "Un paseo por la mañana",
      text:
        "Cada mañana camino hasta la pequeña panadería que está al final de mi calle. El dueño, un hombre tranquilo con harina en las mangas, " +
        "siempre me pregunta si quiero lo de siempre. Yo asiento, y él envuelve una barra de pan caliente en papel marrón. " +
        "De vuelta paso por la vieja biblioteca, donde algunos estudiantes ya esperan a que abran las puertas.",
    },
  ],
});

/**
 * The sample a text came from, if it is one of them unchanged.
 *
 * @param {string} text
 * @returns {{locale: string, id: string} | null}
 */
export function findSample(text) {
  const trimmed = text.trim();
  for (const [locale, list] of Object.entries(SAMPLES)) {
    const match = list.find((sample) => sample.text === trimmed);
    if (match) return { locale, id: match.id };
  }
  return null;
}
