/* Spelarklockor och anslutningsavbrott (arbetsordning L16–L17, beslut 2A, 3A, 26B, huvudplan §9–10).

   Turklockor (L16): varje val som servern kräver av en viss spelare – kortbyte, målval, kortspel, avstående,
   startbekräftelse och Fortsätt – får 90 sekunder. Klockorna sparas med matchen som
   { [spelare]: { nyckel, start, deadline } }. Nyckeln beskriver valet; efter varje ändring räknas kraven om och
   en klocka behåller sin deadline så länge nyckeln är densamma. Vanlig väntan på andra ger inget krav.

   Avbrott (L17): när en levande spelares anslutning försvinner får hen en frist på min(30 s, 90 s − förbrukad
   budget), sparad som `avbrott { [spelare]: { id, generation, start, deadline } }`. Under avbrottet är just den
   spelarens turklocka pausad (`deadline: null, kvar`); ett nytt val som uppstår under avbrottet får sina 90 s
   först vid återkomsten. Övrigas klockor går vidare och de kan göra allt som inte kräver den frånkopplade.
   Återkomst före fristens slut drar den faktiska väntetiden från budgeten (`avbrottsbudget`) en gång och
   återupptar klockan med sparad tid. Ett nytt avbrott ger en ny frist; samma avbrott ger aldrig en ny.

   Tid: ett kommando eller en återkomst är i tid om serverns mottagningstid < deadline; exakt på deadline är för
   sent. Timern läggs i matchens kö (samma ordning som kommandon och anslutningshändelser) och prövar på nytt vad
   som verkligen gått ut – vid tiden då den lades i kön, inte när kön hinner fram. Får timern vänta i kön kan
   den alltså aldrig slå ut någon vars återkomst eller drag togs emot i tid och köades efter den. Alla vars turklocka eller frist gått ut slås ut i en och samma händelse innan vinnaren
   prövas. Är ingen levande spelare utanför den gruppen ansluten men någon har tid kvar, väntar avgörandet in
   deras frister (26B: "vänta in kvarvarande frister innan vinnare fastställs"); går alla ut avbryts matchen utan
   vinnare. Före varje nytt matchkommando behandlas det som gått ut vid kommandots mottagningstid.

   En dubbel eller sen timer hittar inget utgånget och gör ingenting. Timern planeras alltid till nästa deadline
   efter den senaste kontrollen, så en tidsgräns som inte kan få effekt (motorfel, eller väntan på frånkopplade)
   aldrig planeras om i en tät slinga. Inga timers överlever en serveromstart (L18). */
export const TURTID_MS = 90_000;
export const VARNING_MS = 20_000;          // klienterna varnar när mindre än så här återstår
export const AVBROTT_MS = 30_000;          // högst per avbrott (2A)
export const AVBROTT_BUDGET_MS = 90_000;   // sammanlagt per spelare och match (2A)
export const TIDEN_UTE = 'Tiden för ditt val har gått ut.';
/* Offentliga händelser när en deltagare tappar anslutningen eller kommer tillbaka (L17). */
export const ANSLUTNINGSHANDELSE = Object.freeze({ disconnected: 'AVBROTT', reconnected: 'ÅTERANSLUTEN' });

/* Nya klockor ur kraven { [spelare]: nyckel }: samma nyckel behåller sin klocka, ett nytt val får 90 s.
   För en frånkopplad spelare (`pausade`) väntar ett nytt val med sina 90 s tills hen återkommer. */
export function uppdateraKlockor(gamla, krav, now, pausade = {}) {
  const nya = {};
  for (const [playerId, nyckel] of Object.entries(krav)) {
    const g = gamla?.[playerId];
    if (g && g.nyckel === nyckel) nya[playerId] = g;
    else nya[playerId] = pausade[playerId] ? { nyckel, start: now, deadline: null, kvar: TURTID_MS } : { nyckel, start: now, fran: now, deadline: now + TURTID_MS };
  }
  return nya;
}

/* Pausar en löpande klocka vid `now` (avbrottets början, som kan ligga före en klocka som startat senare –
   `fran` är när klockan senast började gå). En klocka som redan gått ut pausas inte: den tidsgränsen gäller. */
const pausa = (klockor, playerId, now) => {
  const k = klockor?.[playerId];
  if (!k || !Number.isFinite(k.deadline) || k.deadline <= now) return klockor ?? {};
  return { ...klockor, [playerId]: { ...k, deadline: null, kvar: k.deadline - Math.max(now, k.fran ?? k.start) } };
};
const ateruppta = (klockor, playerId, now) => {
  const k = klockor?.[playerId];
  if (!k || k.deadline !== null) return klockor ?? {};
  const { kvar, ...rest } = k;
  return { ...klockor, [playerId]: { ...rest, fran: now, deadline: now + kvar } };
};

/* Har spelaren ett krav vars tid redan gått ut när kommandot togs emot? (En pausad klocka går inte ut.) */
export const forSent = (klockor, playerId, mottagen) => Number.isFinite(klockor?.[playerId]?.deadline) && klockor[playerId].deadline <= mottagen;

/* Spelare vars turklocka gått ut vid `now` (exakt på deadline räknas som för sent). */
export const utgangna = (klockor, now) => Object.entries(klockor ?? {}).filter(([, k]) => Number.isFinite(k.deadline) && k.deadline <= now).map(([id]) => id);

/* ---- Avbrott (L17) ---- */
/* En stängd ström blir ett avbrott först efter en kort nåd (omladdning, sidbyte). Går spelarens löpande turklocka
   ut innan nåden är slut registreras avbrottet direkt, så att det upptäckta avbrottet skyddar den kvarvarande
   turtiden. */
export const gaUtUnderNaden = (post, playerId, tid, nad) => Number.isFinite(post.klockor?.[playerId]?.deadline) && post.klockor[playerId].deadline <= tid + nad;

/* Registrerar ett upptäckt avbrott. Samma pågående avbrott ger ingen ny frist. Returnerar avbrottet eller null. */
export function registreraAvbrott(post, playerId, generation, now) {
  post.avbrott ??= {};
  post.avbrottsbudget ??= {};
  if (post.avbrott[playerId]) return null;
  const kvarBudget = Math.max(0, AVBROTT_BUDGET_MS - (post.avbrottsbudget[playerId] ?? 0));
  const avbrott = { id: `${playerId}:${generation}`, generation, start: now, deadline: now + Math.min(AVBROTT_MS, kvarBudget) };
  post.avbrott[playerId] = avbrott;
  post.klockor = pausa(post.klockor, playerId, now);
  return avbrott;
}

/* Återkomst: i tid om now < fristens deadline. Debiterar budgeten exakt en gång och återupptar turklockan.
   Returnerar 'återansluten', 'för sent' (spelaren slås ut av fristkontrollen) eller null (inget avbrott). */
export function avslutaAvbrott(post, playerId, now) {
  const a = post.avbrott?.[playerId];
  if (!a) return null;
  if (now >= a.deadline) return 'för sent';
  post.avbrottsbudget[playerId] = (post.avbrottsbudget[playerId] ?? 0) + (now - a.start);
  delete post.avbrott[playerId];
  post.klockor = ateruppta(post.klockor, playerId, now);
  return 'återansluten';
}

/* Har spelaren kommit tillbaka (eller skickat något) först efter sin frist? Då får hen aldrig spela vidare. */
export const fristSlut = (post, playerId, mottagen) => Number.isFinite(post.avbrott?.[playerId]?.deadline) && post.avbrott[playerId].deadline <= mottagen;
export const FOR_SENT_TILLBAKA = 'Du kom inte tillbaka i tid efter avbrottet.';

/* Levande spelare vars frist eller turklocka gått ut vid `now`, med orsak. */
export function utgangnaMedOrsak(post, levande, now, { tid, avbrott }) {
  const ut = {};
  for (const id of levande) {
    const a = post.avbrott?.[id];
    if (a && a.deadline <= now) ut[id] = avbrott;
    else if (forSent(post.klockor, id, now)) ut[id] = tid;
  }
  return ut;
}

/* 26B: är alla levande utanför gruppen frånkopplade (och finns någon kvar) väntar avgörandet på deras frister. */
export function skaVanta(post, levande, ut) {
  const kvar = levande.filter(id => !(id in ut));
  return kvar.length > 0 && kvar.every(id => post.avbrott?.[id]);
}

/* Efter ett motorsteg: utslagna har inga avbrott; en avslutad match har varken avbrott eller klockor. */
export function stadaAvbrott(post, levande, over) {
  if (over) { post.avbrott = {}; return; }
  for (const id of Object.keys(post.avbrott ?? {})) if (!levande.includes(id)) delete post.avbrott[id];
}

/* Alla deadlines som timern ska vakna för: turklockor som går och avbrottsfrister. */
export const deadlines = post => [
  ...Object.values(post?.klockor ?? {}).map(k => k.deadline),
  ...Object.values(post?.avbrott ?? {}).map(a => a.deadline)
].filter(Number.isFinite);

/* Vyns offentliga del: löpande turklockor och avbrottsfrister per spelar-ID (eller plats i duellen). */
export function klockvy(post, idFor = id => id) {
  const clocks = {}, disconnects = {};
  for (const [id, k] of Object.entries(post.klockor ?? {})) if (Number.isFinite(k.deadline)) clocks[idFor(id)] = k.deadline;
  for (const [id, a] of Object.entries(post.avbrott ?? {})) disconnects[idFor(id)] = a.deadline;
  return { clocks, disconnects };
}

/* Timers per match. `tidsgrans({ ops, matchId, now, slump })` (matcher.js) behandlar allt som gått ut i en
   transaktion och returnerar true om något ändrades; `post(matchId)` läser den sparade matchen. */
export function skapaTurklockor({ lagring, klocka, ko, slump, tidsgrans, post, logg = { info() {}, warn() {}, error() {} } }) {
  const timers = new Map();     // matchId -> { id, at }
  const pagaende = new Set();   // köade körningar (för tester och avstängning)
  const lyssnare = new Set();
  let stangd = false;
  const meddela = matchId => { for (const fn of lyssnare) { try { fn(matchId); } catch (error) { logg.warn(`[klockor] utskick: ${error.message}`); } } };
  /* Köade körningar får aldrig ge ett ohanterat fel (det skulle fälla processen); felen loggas. */
  const sparaKorning = korning => {
    const saker = korning.catch(error => { logg.error(`[klockor] ${error.message}`); return false; });
    pagaende.add(saker);
    saker.finally(() => pagaende.delete(saker));
    return saker;
  };

  /* Planerar timern till tidigaste deadline efter `efter` (standard: alla). */
  function planera(matchId, efter = -Infinity) {
    if (stangd) return;
    const tider = deadlines(post(matchId)).filter(t => t > efter);
    const at = tider.length ? Math.min(...tider) : null;
    const gammal = timers.get(matchId);
    if (gammal && gammal.at === at) return;
    if (gammal) { klocka.clearTimeout(gammal.id); timers.delete(matchId); }
    if (at === null) return;
    /* Kontrollen prövar vid köläggningens tid: det som köats efter den prövas mot sin egen mottagningstid. */
    const lagg = () => { const tid = klocka.now(); sparaKorning(ko.kor(`match:${matchId}`, () => kontrollera(matchId, tid))); };
    if (at <= klocka.now()) { lagg(); return; }   // redan passerad (t.ex. medan kön väntade): i kön direkt
    const id = klocka.setTimeout(() => {
      if (timers.get(matchId)?.id === id) timers.delete(matchId);
      lagg();
    }, at - klocka.now());
    timers.set(matchId, { id, at });
  }

  /* Behandlar allt som gått ut vid `tid` (i matchens kö). */
  function kontrollera(matchId, tid = klocka.now()) {
    let andrat = false;
    try {
      andrat = lagring.transaktion(ops => tidsgrans({ ops, matchId, now: tid, slump })) === true;
      if (andrat) logg.info(`[klockor] tidsgräns i match:${matchId}`);
    } catch (error) {
      logg.error(`[klockor] match:${matchId}: ${error.message}`);   // inget sparas; ingen falsk vinst
    }
    try { planera(matchId, tid); } catch (error) { logg.error(`[klockor] planering match:${matchId}: ${error.message}`); }   // bara deadlines efter `tid`
    if (andrat) meddela(matchId);
    return andrat;
  }

  /* En anslutningshändelse (avbrott eller återkomst) i matchens kö. `fore`: pröva först det som gått ut vid
     `tid` (avbrott); annars efteråt (en återkomst kan låta väntande avgöranden gå vidare). */
  function handelse(matchId, tid, fn, { fore = false } = {}) {
    if (stangd) return Promise.resolve(false);
    return sparaKorning(ko.kor(`match:${matchId}`, () => {
      let andrat = fore ? kontrollera(matchId, tid) : false;
      try {
        if (lagring.transaktion(ops => fn(ops)) === true) { andrat = true; meddela(matchId); }
      } catch (error) { logg.error(`[klockor] anslutning i match:${matchId}: ${error.message}`); }
      if (!fore) andrat = kontrollera(matchId, tid) || andrat;
      else { try { planera(matchId); } catch (error) { logg.error(`[klockor] planering match:${matchId}: ${error.message}`); } }   // även en frist som redan gått ut ska prövas direkt
      return andrat;
    }));
  }

  return {
    planera,
    kontrollera,
    handelse,
    pa(fn) { lyssnare.add(fn); return () => lyssnare.delete(fn); },
    klart: async () => { while (pagaende.size) await Promise.all([...pagaende]); },
    timers: () => timers.size,
    stang() { stangd = true; for (const { id } of timers.values()) klocka.clearTimeout(id); timers.clear(); }
  };
}
