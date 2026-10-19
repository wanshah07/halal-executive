// Wanshah 1 (AFIQ) and Wanshah 2 (MIRELD): shaded SVG robots. Gradients and
// highlights give them depth; they float, blink and the antenna glows while
// the provider is active. Motion stops for people who ask for reduced motion.
const THEMES = {
  afiq:   { shell: ['#2bd18a', '#0b6b3a', '#063d22'], visor: ['#0c2b1d', '#04140c'], eye: '#7dffc4', glow: '#29f0a0', accent: '#c9a227', label: 'W1' },
  kios:   { shell: ['#c58bff', '#7a3fd1', '#3d1a7a'], visor: ['#25103f', '#10061f'], eye: '#f1d4ff', glow: '#d08cff', accent: '#f0b429', label: 'W3' },
  mireld: { shell: ['#7fb2ff', '#2a5fc4', '#15306b'], visor: ['#0f1d3a', '#060c1c'], eye: '#9fe0ff', glow: '#5cc8ff', accent: '#f0b429', label: 'W2' },
}

export default function Robot({ tone = 'afiq', state = 'standby', size = 140 }) {
  const t = THEMES[tone] || THEMES.afiq
  const id = `rb-${tone}`
  const on = state === 'active', off = state === 'offline'
  return (
    <svg viewBox="0 0 160 180" width={size} height={size * 1.125} role="img" aria-label={`${{ afiq: 'Wanshah 1', mireld: 'Wanshah 2', kios: 'Wanshah 3' }[tone] || 'Wanshah'} robot, ${state}`} className={`robot ${off ? 'robot-off' : ''}`}>
      <defs>
        <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={t.shell[0]} /><stop offset=".55" stopColor={t.shell[1]} /><stop offset="1" stopColor={t.shell[2]} /></linearGradient>
        <linearGradient id={`${id}-visor`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={t.visor[0]} /><stop offset="1" stopColor={t.visor[1]} /></linearGradient>
        <radialGradient id={`${id}-shine`} cx=".3" cy=".25" r=".7"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".5" stopColor="#fff" stopOpacity=".08" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-glow`}><stop offset="0" stopColor={t.glow} stopOpacity=".9" /><stop offset="1" stopColor={t.glow} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8a96a3" /><stop offset=".5" stopColor="#e8edf2" /><stop offset="1" stopColor="#6b7785" /></linearGradient>
      </defs>
      <ellipse cx="80" cy="172" rx="42" ry="6" fill="#000" opacity=".18" className="robot-shadow" />
      <g className="robot-body">
        {/* antenna */}
        <line x1="80" y1="22" x2="80" y2="8" stroke={`url(#${id}-metal)`} strokeWidth="4" strokeLinecap="round" />
        {on && <circle cx="80" cy="7" r="12" fill={`url(#${id}-glow)`} className="robot-pulse" />}
        <circle cx="80" cy="7" r="5" fill={off ? '#6b7280' : on ? t.glow : t.accent} />
        {/* ears */}
        <rect x="18" y="46" width="12" height="26" rx="5" fill={`url(#${id}-metal)`} />
        <rect x="130" y="46" width="12" height="26" rx="5" fill={`url(#${id}-metal)`} />
        {/* head */}
        <rect x="26" y="22" width="108" height="76" rx="28" fill={`url(#${id}-shell)`} />
        <rect x="26" y="22" width="108" height="76" rx="28" fill={`url(#${id}-shine)`} />
        {/* visor */}
        <rect x="38" y="40" width="84" height="40" rx="18" fill={`url(#${id}-visor)`} />
        <rect x="42" y="43" width="56" height="8" rx="4" fill="#fff" opacity=".12" />
        {/* eyes */}
        <g className={off ? '' : 'robot-eyes'} style={{ transformOrigin: '80px 60px' }}>
          <rect x="54" y="52" width="16" height={off ? 3 : 14} rx={off ? 1.5 : 7} fill={off ? '#4b5563' : t.eye} transform={off ? 'translate(0 6)' : undefined} />
          <rect x="90" y="52" width="16" height={off ? 3 : 14} rx={off ? 1.5 : 7} fill={off ? '#4b5563' : t.eye} transform={off ? 'translate(0 6)' : undefined} />
          {!off && <><circle cx="66" cy="56" r="2.2" fill="#fff" opacity=".85" /><circle cx="102" cy="56" r="2.2" fill="#fff" opacity=".85" /></>}
        </g>
        {/* neck */}
        <rect x="68" y="96" width="24" height="10" rx="3" fill={`url(#${id}-metal)`} />
        {/* torso */}
        <path d="M40 112c0-6 5-10 11-10h58c6 0 11 4 11 10l-6 44c-1 6-6 10-12 10H58c-6 0-11-4-12-10z" fill={`url(#${id}-shell)`} />
        <path d="M40 112c0-6 5-10 11-10h58c6 0 11 4 11 10l-6 44c-1 6-6 10-12 10H58c-6 0-11-4-12-10z" fill={`url(#${id}-shine)`} />
        {/* chest badge */}
        <rect x="60" y="116" width="40" height="26" rx="8" fill={`url(#${id}-visor)`} />
        <text x="80" y="134" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="800" fontSize="13" fill={off ? '#6b7280' : t.eye}>{t.label}</text>
        <circle cx="80" cy="152" r="4" fill={off ? '#4b5563' : on ? t.glow : t.accent} className={on ? 'robot-pulse' : ''} />
        {/* arms */}
        <rect x="24" y="112" width="14" height="40" rx="7" fill={`url(#${id}-metal)`} className="robot-arm-l" />
        <rect x="122" y="112" width="14" height="40" rx="7" fill={`url(#${id}-metal)`} />
      </g>
    </svg>
  )
}
