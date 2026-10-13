/* Förberedelserum och inbjudningar (arbetsordning L04, beslut 1B, 25A). Värden skapar ett rum och
   bjuder in markerade spelare; varje inbjuden accepterar individuellt till samma rum. En obesvarad
   inbjudan reserverar ingen plats, första acceptansen stänger inte de andras inbjudningar, och en
   spelare kan bara vara i ett rum. Allt sker i lagringens transaktion; tidsstyrda steg (utgång,
   frånkoppling före start, städning) körs genom samma kö som kommandona.
   L05: självvalda lag (högst 4 per lag), Redo knutet till rosterVersion och värdens start. Själva
   matchen skapas av en registrerad motor (registreraMotor, L08 för 2 spelare och L14 för 4/6/8) i
   samma transaktion som rummet markeras STARTAD; utan motor är formatet spärrat. */
import { randomBytes } from 'node:crypto';
import { ACTIVITY, CONNECTION, INVITATION, ROOM, LOBBY_COMMAND, RECEIPT, MAX_ROOM_SIZE, MATCH_SIZES, TEAM_IDS, TEAMS, validateRoom, validateInvitation } from '../kontrakt.js';

export const INBJUDAN_TTL_MS = 120_000;          // obesvarad inbjudan löper ut
export const AVBOJ_KARENS_MS = 30_000;           // väntetid innan samma person kan bjudas in igen efter avböjande
export const INBJUDAN_MIN_INTERVALL_MS = 1_000;  // högst ett inbjudningskommando per sekund och värd
export const FRANKOPPLAD_FRIST_MS = 60_000;      // frånkopplad före start tas ur rummet efter denna tid
export const INAKTIVT_RUM_MS = 2 * 60 * 60 * 1000;
export const STADNING_ALDER_MS = 60 * 60 * 1000;
export const MAX_PER_LAG = 4;

export class RumsFel extends Error {}

export function skapaRumshantering({ lagring, klocka, ko, logg = { warn() {} } }) {
  const now = () => klocka.now();
  const timers = new Map();            // 'inbjudan:<id>' | 'frankopplad:<playerId>' -> timer-id
  const motorer = new Map();           // antal deltagare -> fabrik({ ops, room, players, klocka, slump }) => { matchId, rulesVersion, deckVersion }
  const senasteInbjudan = new Map();   // värd -> tidpunkt för senaste inbjudningskommando
  let vidAndring = () => {};           // servern hakar på för att skicka nya vyer efter tidsstyrda ändringar

  const nyttId = prefix => `${prefix}-${randomBytes(6).toString('hex')}`;
  const levande = session => session && session.expiresAt > now();
  const kravSession = (ops, playerId) => { const s = ops.hamtaSession(playerId); if (!levande(s)) throw new RumsFel('Sessionen har gått ut. Välj nick igen.'); return s; };
  const kravRum = (ops, roomId) => { const r = ops.hamtaRum(roomId); if (!r) throw new RumsFel('Rummet finns inte längre.'); return r; };
  const medlem = (room, playerId) => room.players.find(p => p.playerId === playerId);
  const kravOppet = room => {
    if (room.status === ROOM.started) throw new RumsFel('Matchen har startat.');
    if (room.status === ROOM.closed) throw new RumsFel('Rummet är stängt.');
  };
  const medlemAv = session => ({ playerId: session.playerId, nick: session.nick, teamId: null, connection: session.connection, ready: false, readyRosterVersion: null, joinedAt: now() });

  /* Varje rumsändring ökar roomRevision; en ändring av deltagare/lag ökar rosterVersion och nollställer allas Redo. */
  function sparaRum(ops, room, { roster = false } = {}) {
    room.roomRevision += 1;
    if (roster) { room.rosterVersion += 1; for (const p of room.players) { p.ready = false; p.readyRosterVersion = null; } }
    ops.sparaRum(validateRoom(room));
    return room;
  }
  const sattLedig = (ops, session) => ops.sparaSession({ ...session, activity: ACTIVITY.idle, roomId: null, matchId: null });

  function markeraUtgangna(ops) {
    let n = 0;
    for (const inv of ops.listaInbjudningar({ status: INVITATION.pending })) {
      if (inv.expiresAt <= now()) { ops.sparaInbjudan({ ...inv, status: INVITATION.expired }); n += 1; }
    }
    return n;
  }
  function nyligenAvbojt(ops, roomId, playerId) {
    return ops.listaInbjudningar({ roomId, toPlayerId: playerId, status: INVITATION.declined }).some(inv => now() - inv.updatedAt < AVBOJ_KARENS_MS);
  }

  /* ---- Timers: körs i rummets kö så att de aldrig korsar ett kommando ---- */
  function planera(nyckel, ms, arbete) {
    avboka(nyckel);
    timers.set(nyckel, klocka.setTimeout(() => { timers.delete(nyckel); arbete().catch(error => logg.warn(`[rum] ${nyckel}: ${error.message}`)); }, ms));
  }
  function avboka(nyckel) { if (timers.has(nyckel)) { klocka.clearTimeout(timers.get(nyckel)); timers.delete(nyckel); } }
  const planeraUtgang = inv => planera(`inbjudan:${inv.id}`, Math.max(0, inv.expiresAt - now()), () => ko.kor(`rum:${inv.roomId}`, () => {
    if (lagring.transaktion(markeraUtgangna) > 0) vidAndring();
  }));
  const planeraFrankoppling = (playerId, roomId) => planera(`frankopplad:${playerId}`, FRANKOPPLAD_FRIST_MS, () => ko.kor(`rum:${roomId}`, () => {
    const lamnade = lagring.transaktion(ops => {
      const session = ops.hamtaSession(playerId);
      if (!levande(session) || session.roomId !== roomId || session.connection !== CONNECTION.offline) return false;
      lamnaInom(ops, session, roomId);
      return true;
    });
    if (lamnade) vidAndring();
  }));

  /* ---- Kommandon ---- */
  function skapa(playerId) {
    return lagring.transaktion(ops => {
      const session = kravSession(ops, playerId);
      if (session.activity !== ACTIVITY.idle) throw new RumsFel('Du är redan i ett rum eller en match. Lämna det först.');
      const room = { id: nyttId('r'), hostPlayerId: playerId, status: ROOM.preparing, rosterVersion: 0, roomRevision: 0, matchId: null, createdAt: now(), players: [medlemAv(session)] };
      sparaRum(ops, room);
      ops.sparaSession({ ...session, activity: ACTIVITY.inRoom, roomId: room.id });
      return room;
    });
  }

  function bjudIn(playerId, roomId, playerIds) {
    const resultat = lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const room = kravRum(ops, roomId);
      kravOppet(room);
      if (room.hostPlayerId !== playerId) throw new RumsFel('Bara värden kan bjuda in.');
      const senast = senasteInbjudan.get(playerId);
      if (senast !== undefined && now() - senast < INBJUDAN_MIN_INTERVALL_MS) throw new RumsFel('Vänta en stund innan du bjuder in igen.');
      markeraUtgangna(ops);
      const oppna = ops.listaInbjudningar({ roomId, status: INVITATION.pending });
      let platser = MAX_ROOM_SIZE - room.players.length - oppna.length;
      const inbjudna = [], hoppade = [];
      for (const id of [...new Set(playerIds)]) {
        const s = ops.hamtaSession(id);
        const skal = id === playerId ? 'Det är du själv.'
          : !levande(s) ? 'Spelaren finns inte i lobbyn.'
          : s.activity !== ACTIVITY.idle ? 'Spelaren är redan i ett rum eller en match.'
          : s.connection !== CONNECTION.online ? 'Spelaren är inte ansluten.'
          : oppna.some(inv => inv.toPlayerId === id) ? 'Spelaren är redan inbjuden.'
          : nyligenAvbojt(ops, roomId, id) ? 'Spelaren avböjde nyss – vänta en halv minut.'
          : platser <= 0 ? 'Rummet har inte plats för fler inbjudningar.' : null;
        if (skal) { hoppade.push({ playerId: id, nick: s?.nick ?? null, reason: skal }); continue; }
        const inv = validateInvitation({ id: nyttId('i'), roomId, fromPlayerId: playerId, toPlayerId: id, status: INVITATION.pending, expiresAt: now() + INBJUDAN_TTL_MS });
        ops.sparaInbjudan(inv);
        inbjudna.push({ ...inv, nick: s.nick });
        platser -= 1;
      }
      if (!inbjudna.length) throw new RumsFel(hoppade.length ? `Ingen kunde bjudas in. ${hoppade[0].nick ?? 'Spelaren'}: ${hoppade[0].reason}` : 'Ingen mottagare angiven.');
      sparaRum(ops, room);
      return { room, inbjudna, hoppade };
    });
    senasteInbjudan.set(playerId, now());
    for (const inv of resultat.inbjudna) planeraUtgang(inv);
    return resultat;
  }

  function acceptera(playerId, invitationId) {
    return lagring.transaktion(ops => {
      const session = kravSession(ops, playerId);
      markeraUtgangna(ops);
      const inv = ops.hamtaInbjudan(invitationId);
      if (!inv || inv.toPlayerId !== playerId) throw new RumsFel('Inbjudan finns inte.');
      const status = { [INVITATION.accepted]: 'Inbjudan är redan accepterad.', [INVITATION.expired]: 'Inbjudan har gått ut.', [INVITATION.revoked]: 'Inbjudan har återkallats.', [INVITATION.declined]: 'Inbjudan är avböjd.' };
      if (inv.status !== INVITATION.pending) throw new RumsFel(status[inv.status]);
      const room = kravRum(ops, inv.roomId);
      kravOppet(room);
      if (session.activity !== ACTIVITY.idle) throw new RumsFel('Du är redan i ett rum eller en match. Lämna det först.');
      if (room.players.length >= MAX_ROOM_SIZE) throw new RumsFel('Rummet är fullt.');
      room.players.push(medlemAv(session));
      ops.sparaInbjudan({ ...inv, status: INVITATION.accepted });
      for (const annan of ops.listaInbjudningar({ toPlayerId: playerId, status: INVITATION.pending })) ops.sparaInbjudan({ ...annan, status: INVITATION.expired });
      sparaRum(ops, room, { roster: true });
      ops.sparaSession({ ...session, activity: ACTIVITY.inRoom, roomId: room.id });
      return room;
    });
  }

  function avboj(playerId, invitationId) {
    return lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const inv = ops.hamtaInbjudan(invitationId);
      if (!inv || inv.toPlayerId !== playerId) throw new RumsFel('Inbjudan finns inte.');
      if (inv.status !== INVITATION.pending) throw new RumsFel('Inbjudan är inte längre öppen.');
      ops.sparaInbjudan({ ...inv, status: INVITATION.declined });
      return inv;
    });
  }

  function aterkalla(playerId, invitationId) {
    return lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const inv = ops.hamtaInbjudan(invitationId);
      const room = inv && ops.hamtaRum(inv.roomId);
      if (!inv || !room || room.hostPlayerId !== playerId) throw new RumsFel('Inbjudan finns inte.');
      if (inv.status !== INVITATION.pending) throw new RumsFel('Inbjudan är inte längre öppen.');
      ops.sparaInbjudan({ ...inv, status: INVITATION.revoked });
      return inv;
    });
  }

  /* Tar bort en deltagare. Tomt rum stängs och dess inbjudningar återkallas. Lämnar värden,
     tar den längst anslutna kvarvarande deltagaren över (25A); alla måste bekräfta Redo igen. */
  function lamnaInom(ops, session, roomId) {
    const room = kravRum(ops, roomId);
    if (room.status === ROOM.started) throw new RumsFel('Matchen har startat – lämna i så fall matchen, inte rummet.');
    if (room.status === ROOM.closed) { sattLedig(ops, session); return room; }   // avslutad match: tillbaka till lobbyn
    if (!room.players.some(p => p.playerId === session.playerId)) throw new RumsFel('Du är inte med i rummet.');
    room.players = room.players.filter(p => p.playerId !== session.playerId);
    avboka(`frankopplad:${session.playerId}`);
    sattLedig(ops, session);
    if (room.players.length === 0) {
      room.status = ROOM.closed;
      for (const inv of ops.listaInbjudningar({ roomId, status: INVITATION.pending })) ops.sparaInbjudan({ ...inv, status: INVITATION.revoked });
    } else if (room.hostPlayerId === session.playerId) {
      room.hostPlayerId = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)[0].playerId;
    }
    return sparaRum(ops, room, { roster: true });
  }
  function lamna(playerId, roomId) {
    return lagring.transaktion(ops => {
      const session = kravSession(ops, playerId);
      if (session.roomId !== roomId) throw new RumsFel('Du är inte med i rummet.');
      return lamnaInom(ops, session, roomId);
    });
  }

  /* Speglar sessionens anslutning i rummet. Frånkopplad före start får FRANKOPPLAD_FRIST_MS på sig. */
  function markeraAnslutning(playerId, connection) {
    const room = lagring.transaktion(ops => {
      const session = ops.hamtaSession(playerId);
      if (!levande(session) || !session.roomId) return null;
      const room = ops.hamtaRum(session.roomId);
      const me = room?.players.find(p => p.playerId === playerId);
      if (!me || room.status !== ROOM.preparing || me.connection === connection) return null;
      me.connection = connection;
      return sparaRum(ops, room);
    });
    if (room) { if (connection === CONNECTION.offline) planeraFrankoppling(playerId, room.id); else avboka(`frankopplad:${playerId}`); }
    return room;
  }

  /* ---- L05: lag, Redo och start ---- */
  function valjLag(playerId, roomId, teamId) {
    return lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const room = kravRum(ops, roomId);
      kravOppet(room);
      const me = medlem(room, playerId);
      if (!me) throw new RumsFel('Du är inte med i rummet.');
      if (teamId !== null && !TEAM_IDS.includes(teamId)) throw new RumsFel('Okänt lag.');
      if (me.teamId === teamId) return room;
      if (teamId !== null && room.players.filter(p => p.teamId === teamId).length >= MAX_PER_LAG) throw new RumsFel(`${TEAMS.find(t => t.id === teamId).name} är fullt (högst ${MAX_PER_LAG}).`);
      me.teamId = teamId;
      return sparaRum(ops, room, { roster: true });
    });
  }

  function redo(playerId, roomId, ready, rosterVersion) {
    return lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const room = kravRum(ops, roomId);
      kravOppet(room);
      const me = medlem(room, playerId);
      if (!me) throw new RumsFel('Du är inte med i rummet.');
      if (!ready) { if (!me.ready) return room; me.ready = false; me.readyRosterVersion = null; return sparaRum(ops, room); }
      if (rosterVersion !== room.rosterVersion) throw new RumsFel('Uppställningen har ändrats – kontrollera lagen och tryck Redo igen.');
      if (me.connection !== CONNECTION.online) throw new RumsFel('Du är inte ansluten.');
      if (me.teamId === null) throw new RumsFel('Välj lag först.');
      if (me.ready) return room;
      me.ready = true; me.readyRosterVersion = room.rosterVersion;
      return sparaRum(ops, room);
    });
  }

  /* Ren kontroll av startvillkoren (6A, 7B, 9B) med begripliga skäl; används av både start och vyn. */
  function startkontroll(room) {
    const skal = [];
    const n = room.players.length;
    const antal = Object.fromEntries(TEAM_IDS.map(id => [id, room.players.filter(p => p.teamId === id).length]));
    if (!MATCH_SIZES.includes(n)) skal.push(`Vi är ${n}. Matchen kan starta med 2, 4, 6 eller 8 spelare.`);
    const utanLag = room.players.filter(p => p.teamId === null);
    if (utanLag.length) skal.push(`${utanLag.map(p => p.nick).join(', ')} har inte valt lag.`);
    else if (antal.A !== antal.B) skal.push(`Lagen är ojämna: ${antal.A} mot ${antal.B}. Någon behöver byta lag.`);
    const franvarande = room.players.filter(p => p.connection !== CONNECTION.online);
    if (franvarande.length) skal.push(`${franvarande.map(p => p.nick).join(', ')} är inte ansluten.`);
    const inteRedo = room.players.filter(p => p.connection === CONNECTION.online && !(p.ready && p.readyRosterVersion === room.rosterVersion));
    if (inteRedo.length) skal.push(`Väntar på ${inteRedo.map(p => p.nick).join(', ')}.`);
    const format = n === 2 ? 'duell' : 'lag';
    const tillganglig = motorer.has(n);
    if (!skal.length && !tillganglig) skal.push(`Matchformatet för ${n} spelare är ännu inte tillgängligt.`);
    return { kanStarta: skal.length === 0, skal, antal, format, tillganglig, tillgangligaFormat: MATCH_SIZES.filter(size => motorer.has(size)) };
  }

  function registreraMotor(antal, fabrik) {
    if (!MATCH_SIZES.includes(antal)) throw new Error(`Ogiltigt deltagarantal: ${antal}`);
    motorer.set(antal, fabrik);
  }

  /* Starttransaktion: rummet låses (STARTAD + matchId), matchen skapas av motorn i samma transaktion,
     öppna inbjudningar stängs och alla deltagare blir SPELAR. En sen acceptans ändrar rosterVersion
     och avvisar därmed startkommandot, eller avvisas själv av STARTAD – aldrig båda. */
  function starta(playerId, roomId, rosterVersion, { slump = Math.random } = {}) {
    const room = lagring.transaktion(ops => {
      kravSession(ops, playerId);
      const room = kravRum(ops, roomId);
      kravOppet(room);
      if (room.hostPlayerId !== playerId) throw new RumsFel('Bara värden kan starta matchen.');
      if (rosterVersion !== room.rosterVersion) throw new RumsFel('Uppställningen har ändrats – kontrollera lagen och be alla trycka Redo igen.');
      const kontroll = startkontroll(room);
      if (!kontroll.kanStarta) throw new RumsFel(kontroll.skal.join(' '));
      const players = room.players.map(p => ({ playerId: p.playerId, nick: p.nick, teamId: p.teamId }));
      const match = motorer.get(room.players.length)({ ops, room, players, klocka, slump });
      if (!match?.matchId) throw new Error('Matchmotorn returnerade inget matchId.');
      room.status = ROOM.started;
      room.matchId = match.matchId;
      for (const inv of ops.listaInbjudningar({ roomId, status: INVITATION.pending })) ops.sparaInbjudan({ ...inv, status: INVITATION.revoked });
      for (const p of room.players) { avboka(`frankopplad:${p.playerId}`); ops.sparaSession({ ...ops.hamtaSession(p.playerId), activity: ACTIVITY.playing, matchId: match.matchId }); }
      return sparaRum(ops, room);
    });
    return room;
  }

  /* Matchen är slut (L08): rummet stängs men deltagarna står kvar tills de lämnar; sessionerna FÖLJER_AVSLUT. */
  function markeraMatchAvslutad(ops, roomId) {
    const room = ops.hamtaRum(roomId);
    if (!room || room.status !== ROOM.started) return null;
    room.status = ROOM.closed;
    for (const p of room.players) { const s = ops.hamtaSession(p.playerId); if (s && s.matchId === room.matchId) ops.sparaSession({ ...s, activity: ACTIVITY.finished }); }
    return sparaRum(ops, room);
  }

  /* Det en spelare ser: eget rum (om något), inkommande öppna inbjudningar och – som värd – utgående. */
  function vyFor(playerId) {
    return lagring.transaktion(ops => {
      const session = ops.hamtaSession(playerId);
      if (!levande(session)) return { rum: null, inbjudningar: { inkommande: [], utgaende: [] } };
      markeraUtgangna(ops);
      const nick = id => ops.hamtaSession(id)?.nick ?? null;
      const rum = session.roomId ? ops.hamtaRum(session.roomId) : null;
      const inkommande = ops.listaInbjudningar({ toPlayerId: playerId, status: INVITATION.pending }).map(inv => ({ id: inv.id, roomId: inv.roomId, from: { playerId: inv.fromPlayerId, nick: nick(inv.fromPlayerId) }, expiresAt: inv.expiresAt }));
      const utgaende = rum && rum.hostPlayerId === playerId ? ops.listaInbjudningar({ roomId: rum.id, status: INVITATION.pending }).map(inv => ({ id: inv.id, to: { playerId: inv.toPlayerId, nick: nick(inv.toPlayerId) }, expiresAt: inv.expiresAt })) : [];
      return { rum: rum ? validateRoom(rum) : null, start: rum && rum.status === ROOM.preparing ? startkontroll(rum) : null, inbjudningar: { inkommande, utgaende } };
    });
  }

  /* Periodisk städning: inaktiva förberedelserum stängs, gamla stängda rum och besvarade inbjudningar raderas. */
  function stada() {
    return lagring.transaktion(ops => {
      let stangda = 0;
      for (const room of ops.listaRum(ROOM.preparing, now() - INAKTIVT_RUM_MS)) {
        for (const p of room.players) { const s = ops.hamtaSession(p.playerId); if (s) sattLedig(ops, s); avboka(`frankopplad:${p.playerId}`); }
        for (const inv of ops.listaInbjudningar({ roomId: room.id, status: INVITATION.pending })) ops.sparaInbjudan({ ...inv, status: INVITATION.revoked });
        room.players = []; room.status = ROOM.closed; sparaRum(ops, room, { roster: true }); stangda += 1;
      }
      let raderade = 0;
      for (const room of ops.listaRum(ROOM.closed, now() - STADNING_ALDER_MS)) { ops.raderaRum(room.id); raderade += 1; }
      for (const status of [INVITATION.accepted, INVITATION.declined, INVITATION.expired, INVITATION.revoked]) ops.raderaInbjudningar(status, now() - STADNING_ALDER_MS);
      return { utgangna: markeraUtgangna(ops), stangda, raderade };
    });
  }

  /* Efter serverstart: inga timers finns; planera om öppna inbjudningar. Frånkopplade i rum städas av fristen. */
  function aterstall() {
    for (const inv of lagring.listaInbjudningar({ status: INVITATION.pending })) planeraUtgang(inv);
    for (const room of lagring.listaRum(ROOM.preparing)) for (const p of room.players) if (p.connection === CONNECTION.offline) planeraFrankoppling(p.playerId, room.id);
  }

  function registrera(tjanst) {
    const wrap = fn => args => {
      try { const r = fn(args); return { status: RECEIPT.ok, message: r?.message ?? null, roomRevision: r?.room?.roomRevision ?? r?.roomRevision ?? null }; }
      catch (error) { if (error instanceof RumsFel) return { status: RECEIPT.rejected, message: error.message }; throw error; }
    };
    tjanst.registrera(LOBBY_COMMAND.createRoom, wrap(({ playerId }) => ({ room: skapa(playerId) })));
    tjanst.registrera(LOBBY_COMMAND.invite, wrap(({ playerId, command }) => {
      const { room, inbjudna, hoppade } = bjudIn(playerId, command.roomId, command.payload.playerIds);
      const text = [`Inbjudan skickad till ${inbjudna.map(i => i.nick).join(', ')}.`, ...hoppade.map(h => `${h.nick ?? h.playerId}: ${h.reason}`)].join(' ');
      return { room, message: text };
    }));
    tjanst.registrera(LOBBY_COMMAND.accept, wrap(({ playerId, command }) => ({ room: acceptera(playerId, command.payload.invitationId) })));
    tjanst.registrera(LOBBY_COMMAND.decline, wrap(({ playerId, command }) => { avboj(playerId, command.payload.invitationId); return {}; }));
    tjanst.registrera(LOBBY_COMMAND.revoke, wrap(({ playerId, command }) => { aterkalla(playerId, command.payload.invitationId); return {}; }));
    tjanst.registrera(LOBBY_COMMAND.leave, wrap(({ playerId, command }) => ({ room: lamna(playerId, command.roomId) })));
    tjanst.registrera(LOBBY_COMMAND.team, wrap(({ playerId, command }) => ({ room: valjLag(playerId, command.roomId, command.payload.teamId) })));
    tjanst.registrera(LOBBY_COMMAND.ready, wrap(({ playerId, command }) => ({ room: redo(playerId, command.roomId, command.payload.ready, command.payload.rosterVersion) })));
    tjanst.registrera(LOBBY_COMMAND.start, wrap(({ playerId, command, slump }) => {
      if (!tjanst.matchtrafik.oppen) throw new RumsFel(tjanst.matchtrafik.orsak);
      if (!Number.isInteger(command.payload.rosterVersion)) throw new RumsFel('Start kräver aktuell rosterVersion.');
      return { room: starta(playerId, command.roomId, command.payload.rosterVersion, { slump }) };
    }));
  }

  return {
    skapa, bjudIn, acceptera, avboj, aterkalla, lamna, valjLag, redo, starta, startkontroll, registreraMotor, markeraMatchAvslutad, markeraAnslutning, vyFor, stada, aterstall, registrera,
    markeraUtgangna: () => lagring.transaktion(markeraUtgangna),
    pa: fn => { vidAndring = fn; },
    timers: () => timers.size
  };
}
