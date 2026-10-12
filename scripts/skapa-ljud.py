"""Återskapa spelets syntetiska ljud: Python, NumPy och FFmpeg krävs."""
import wave
import numpy as np
SR=32000
DURATION=76
rng=np.random.default_rng(451)
N=int(DURATION*SR)
def hz(m): return 440*2**((m-69)/12)
def timeline(d): return np.arange(int(SR*d))/SR
def envelope(t, d, attack=.05, release=.25): return np.minimum(t/attack,1)*np.minimum(np.maximum(d-t,0)/release,1)
def filt(x, cutoff):
    f=np.fft.rfftfreq(len(x),1/SR)
    return np.fft.irfft(np.fft.rfft(x)/(1+(f/cutoff)**6),n=len(x))
def pluck(m,d=2.3):
    t=timeline(d); f=hz(m); s=np.zeros(len(t))
    for h in range(1,13):
        s+=np.sin(2*np.pi*f*h*t+.14*h)*np.sin(np.pi*h*.27)*np.exp(-t*(1.8+.55*h))/h**.8
    s+=filt(rng.normal(0,1,len(t)),3300)*np.exp(-t*70)*.14
    return s*np.minimum(t/.003,1)*envelope(t,d,.002,.2)
def strings(m,d,soft=False):
    t=timeline(d);s=np.zeros(len(t)); f=hz(m)
    for det,phase0 in [(-.003,1.1),(.001,2.3),(.004,.4)]:
        phase=2*np.pi*f*(1+det)*t+.075*np.sin(2*np.pi*(4.7+det*80)*t+phase0)
        for h in range(1,13):
            s+=np.sin(h*phase+phase0)*np.exp(-h/(3.7 if soft else 6))/h**.85
    s/=3
    return s*envelope(t,d,.32 if soft else .16,.65)*(.92+.08*np.sin(np.pi*t/d))
def drum(deep=False):
    t=timeline(1.5 if deep else .7)
    phase=2*np.pi*((44 if deep else 95)*t+30*(1-np.exp(-t*18))/18)
    return np.sin(phase)*np.exp(-t*(3.8 if deep else 9))+.18*filt(rng.normal(0,1,len(t)),1500)*np.exp(-t*30)
def attack(dramatic=False,magic=False):
    t=timeline(1.1);n=filt(rng.normal(0,1,len(t)),6500)
    swish=n*np.exp(-((t-.27)/.14)**2)*(.6 if dramatic else .4)
    if magic:
        phase=2*np.pi*(500*t+750*t*t)
        swish+=.16*(np.sin(phase)+.4*np.sin(1.5*phase))*np.exp(-t*3)*np.minimum(t/.05,1)
    else:
        for f in [1700,2390,3250]:swish+=.065*np.sin(2*np.pi*f*t)*np.exp(-np.maximum(t-.38,0)*12)*(t>.38)
    return swish

def shield(dramatic=False):
    t=timeline(1.7);s=np.zeros(len(t))
    for f,a,decay in [(340,1,5),(691,.55,6),(1128,.36,4.5),(1831,.25,6),(2637,.14,7)]:
        s+=a*np.sin(2*np.pi*f*t)*np.exp(-t*decay)
    s+=filt(rng.normal(0,1,len(t)),4600)*np.exp(-t*65)*.65
    return s*np.minimum(t/.002,1)*(.32 if dramatic else .24)

def add(track,s,start,amp=1,pan=0):
    i=int(start*SR);l=min(len(s),len(track)-i)
    if l<=0:return
    gains=np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)])
    track[i:i+l]+=amp*s[:l,None]*gains

chords=[[50,57,62,65],[48,55,60,64],[46,53,58,62],[45,52,57,61],[50,57,62,65],[41,53,57,60],[43,55,58,62],[45,52,57,61]]
melodies=[[(74,0,1.35),(77,1.5,.8),(76,2.5,.7),(74,3.25,.65)],[(72,0,1.7),(69,2,1.4)],[(70,0,1),(74,1.25,.85),(77,2.5,1.25)],[(76,0,1.5),(73,2,1.45)],[(74,0,1.2),(69,1.5,.8),(74,2.5,1.1)],[(77,0,1.7),(76,2,.85),(72,3,.7)],[(74,0,1.2),(70,1.5,.8),(69,2.5,1.2)],[(73,0,1.4),(76,1.75,.7),(73,2.75,1)]]
beat=.75

# Originalmusik för Tornstriden. Alternativ 2, utan inbakade stridsljud.
# Tre 24-sekundersfraser ger variation; efterklangen viks över loopens början.
from pathlib import Path
import subprocess, tempfile
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'ljud'
OUT.mkdir(parents=True, exist_ok=True)
music=np.zeros((N,2))
for cycle in range(3):
    for bar,chord in enumerate(chords):
        start=cycle*24+bar*3
        intensity=[1,.78,1.15][cycle]*(1 if bar<5 else 1.2)
        for j,m in enumerate(chord):add(music,strings(m,3.5),start,.11*intensity,(j-1.5)*.3)
        for m,b,d in melodies[bar]:
            add(music,strings(m-(12 if cycle==1 else 0),d*beat+.3),start+b*beat,.19,.1)
        for b in ([0,2] if cycle==1 else [0,2,3.5]):add(music,drum(True),start+b*beat,.27*intensity,-.08)
        if bar>3:
            for b in [1,2.5,3]:add(music,pluck(chord[1]+12,.65),start+b*beat,.1,.25)

def room(src,wet):
    dry=src.copy()
    for k,delay in enumerate([.043,.079,.127,.191,.271,.383]):
        shift=int(delay*SR);src[shift:]+=dry[:-shift,::-1 if k%2 else 1]*wet*(.68**k)
    return src

def save(name,samples):
    samples=np.tanh(samples*1.25)
    samples*=.85/max(np.max(np.abs(samples)),1e-6)
    with tempfile.TemporaryDirectory() as folder:
        wav=Path(folder)/'source.wav'
        with wave.open(str(wav),'w') as w:
            w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR)
            w.writeframes((samples*32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','160k',str(OUT/name)],check=True)
    print(name,round(len(samples)/SR,2),'sekunder')

music=room(music,.31)
loop=music[:72*SR].copy()
loop[:4*SR]+=music[72*SR:]
save('strid-musik.mp3',loop)
for name,signal in [('anfall.mp3',attack(True)),('magi.mp3',attack(True,True)),('forsvar.mp3',shield(True))]:
    track=np.zeros((int(2.4*SR),2));add(track,signal,0,.85)
    if name!='forsvar.mp3':add(track,drum(True),.35,.22)
    track=room(track,.23)
    track*=np.minimum(np.arange(len(track))[::-1]/(.15*SR),1)[:,None]
    save(name,track)

# Långsammare fysisk kortblandning: dra isär, släpp korten, samla leken.
shuffle_rng=np.random.default_rng(128)
track=np.zeros((int(2.05*SR),2))

def card_flick():
    t=timeline(.105)
    noise=shuffle_rng.normal(0,1,len(t))
    paper=filt(noise,5100)-filt(noise,600)
    # Kortets torra flapp har en kropp och ett kort, strävt anslag.
    flex=(np.sin(2*np.pi*shuffle_rng.uniform(430,620)*t)*.5
          +np.sin(2*np.pi*shuffle_rng.uniform(1050,1450)*t)*.2)*np.exp(-t*85)
    return (paper*np.exp(-t*55)*.75+flex)*np.minimum(t/.001,1)

# Två skrapningar när korthalvorna dras ut och trycks ihop.
for start,duration,pan in [(.02,.23,-.25),(.94,.3,.25)]:
    t=timeline(duration)
    noise=shuffle_rng.normal(0,1,len(t))
    paper=filt(noise,3800)-filt(noise,450)
    grain=.45+.55*np.sin(2*np.pi*38*t)**2
    scrape=paper*grain*np.sin(np.pi*t/duration)**2
    add(track,scrape,start,.065,pan)

# Ojämna, separata kortsläpp gör att blandningen inte låter som ett jämnt brus.
for start,intervals in [(.21,[.048,.052,.041,.055,.046,.06,.051,.044,.057,.05]),
                        (1.03,[.055,.048,.046,.042,.04,.036,.033,.032,.03,.03,.033,.038])]:
    at=start
    for n,gap in enumerate(intervals):
        add(track,card_flick(),at,shuffle_rng.uniform(.24,.36),(-1)**n*.2)
        at+=gap

# Ett par mjuka, torra knack när kortkanterna jämnas till mot bordet.
for at,amp in [(1.71,.6),(1.86,.38)]:
    t=timeline(.16)
    noise=filt(shuffle_rng.normal(0,1,len(t)),2600)
    tap=(np.sin(2*np.pi*155*t)*.2+noise*.38)*np.exp(-t*48)*np.minimum(t/.0015,1)
    add(track,tap,at,amp)
save('kortblandning.mp3',track)

# Ett enda kort: kort papperssvep följt av ett torrt flapp mot bordet.
card_rng=np.random.default_rng(729)
track=np.zeros((int(.28*SR),2))
t=timeline(.1)
noise=card_rng.normal(0,1,len(t))
paper=filt(noise,4800)-filt(noise,650)
add(track,paper*np.sin(np.pi*t/.1)**2,0,.1)
t=timeline(.18)
noise=card_rng.normal(0,1,len(t))
paper=filt(noise,5200)-filt(noise,550)
flex=(.5*np.sin(2*np.pi*480*t)+.2*np.sin(2*np.pi*1170*t))*np.exp(-t*65)
flap=(paper*.6*np.exp(-t*55)+flex)*np.minimum(t/.001,1)
add(track,flap,.075,.65)
save('kortlaggning.mp3',track)
