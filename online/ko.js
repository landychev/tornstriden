/* Ordnade kommandoköer (arbetsordning L02): allt som rör samma rum eller match körs ett i taget,
   i mottagningsordning. Olika nycklar blockerar inte varandra. Timerhändelser (L16) läggs i samma kö. */
export function skapaKo() {
  const kedjor = new Map();
  return {
    kor(nyckel, arbete) {
      const foregaende = kedjor.get(nyckel) ?? Promise.resolve();
      const egen = foregaende.then(arbete, arbete);
      const sista = egen.finally(() => { if (kedjor.get(nyckel) === sista) kedjor.delete(nyckel); });
      kedjor.set(nyckel, sista);
      return egen;
    },
    vantande: () => kedjor.size
  };
}
