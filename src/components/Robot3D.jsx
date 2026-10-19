// Wanshah 3 as a real 3D robot (Wan, 19 Oct 2026): boxes in CSS 3D
// (preserve-3d, no library), turning slowly side to side so every face shows.
// Head with a visor, antenna, torso with the W3 badge and two arms. The antenna
// and eyes glow while active; off, everything goes grey. Motion stops for
// visitors who ask for reduced motion (it keeps a fixed three-quarter view).
const SHADE = {
  front: 'linear-gradient(160deg,#c58bff,#7a3fd1 60%,#5a2aa8)',
  back: '#3d1a7a', right: 'linear-gradient(90deg,#5a2aa8,#3d1a7a)', left: 'linear-gradient(90deg,#8d52e0,#6a33b8)',
  top: 'linear-gradient(180deg,#e2c2ff,#b57cf0)', bottom: '#241048',
}
const METAL = { front: 'linear-gradient(90deg,#8a96a3,#e8edf2,#6b7785)', back: '#5b6672', right: '#6b7785', left: '#aab4bf', top: '#e8edf2', bottom: '#4b5560' }
const GREY = { front: '#7b8088', back: '#4b5059', right: '#5a5f68', left: '#8b9098', top: '#a0a5ad', bottom: '#3a3e45' }

// One box centred on (x, y, z): six faces; `front` may carry content.
function Box({ w, h, d, x = 0, y = 0, z = 0, shade, radius = 0, children, className = '', style }) {
  const f = (name, fw, fh, tf, kids) => (
    <div key={name} className="r3-face" style={{ width: fw, height: fh, marginLeft: -fw / 2, marginTop: -fh / 2, transform: tf, background: shade[name], borderRadius: radius }}>{kids}</div>
  )
  return (
    <div className={`r3-box ${className}`} style={{ transform: `translate3d(${x}px,${y}px,${z}px)`, ...style }}>
      {f('front', w, h, `translateZ(${d / 2}px)`, children)}
      {f('back', w, h, `rotateY(180deg) translateZ(${d / 2}px)`)}
      {f('right', d, h, `rotateY(90deg) translateZ(${w / 2}px)`)}
      {f('left', d, h, `rotateY(-90deg) translateZ(${w / 2}px)`)}
      {f('top', w, d, `rotateX(90deg) translateZ(${h / 2}px)`)}
      {f('bottom', w, d, `rotateX(-90deg) translateZ(${h / 2}px)`)}
    </div>
  )
}

export default function Robot3D({ state = 'standby', size = 140, label = 'W3', name = 'Wanshah 3' }) {
  const on = state === 'active', off = state === 'offline'
  const body = off ? GREY : SHADE, metal = off ? GREY : METAL
  const eye = off ? '#4b5563' : '#f1d4ff', glow = off ? '#6b7280' : '#d08cff'
  const k = size / 160
  return (
    <div className={`r3-scene ${off ? 'r3-off' : ''}`} style={{ width: size, height: size * 1.125 }} role="img" aria-label={`${name} 3D robot, ${state}`}>
      <div className="r3-stage" style={{ transform: `scale(${k})` }}>
        <div className="r3-shadow" />
        <div className="r3-rig">
          <div className="r3-bob">
            {/* antenna: a stem and a ball made of two crossed discs */}
            <Box w={4} h={18} d={4} y={-96} shade={metal} />
            <div className="r3-box" style={{ transform: 'translate3d(0,-110px,0)' }}>
              {[0, 90].map((a) => <div key={a} className={`r3-disc ${on ? 'r3-pulse' : ''}`} style={{ transform: `rotateY(${a}deg)`, background: `radial-gradient(circle at 35% 30%,#fff,${glow} 55%,${off ? '#4b5563' : '#7a3fd1'})` }} />)}
            </div>
            {/* head */}
            <Box w={92} h={68} d={68} y={-56} shade={body} radius={14}>
              <div className="r3-visor">
                <i className={`r3-eye ${off ? 'r3-eye-off' : 'r3-blink'}`} style={{ background: eye, boxShadow: on ? `0 0 10px ${glow}` : 'none' }} />
                <i className={`r3-eye ${off ? 'r3-eye-off' : 'r3-blink'}`} style={{ background: eye, boxShadow: on ? `0 0 10px ${glow}` : 'none' }} />
              </div>
            </Box>
            <Box w={10} h={24} d={18} x={-52} y={-56} shade={metal} />
            <Box w={10} h={24} d={18} x={52} y={-56} shade={metal} />
            {/* neck and torso */}
            <Box w={22} h={10} d={22} y={-16} shade={metal} />
            <Box w={78} h={62} d={48} y={22} shade={body} radius={10}>
              <div className="r3-badge" style={{ color: eye }}>{label}<b className={on ? 'r3-pulse' : ''} style={{ background: glow }} /></div>
            </Box>
            {/* arms */}
            <Box w={14} h={48} d={16} x={-52} y={22} shade={metal} radius={6} className="r3-arm-l" />
            <Box w={14} h={48} d={16} x={52} y={22} shade={metal} radius={6} />
          </div>
        </div>
      </div>
    </div>
  )
}
