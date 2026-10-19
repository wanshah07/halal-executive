// One palette for all three Wanshah robots, and the colour maths that turns a
// theme into the six faces of a CSS 3D box.
//
// This file exists because the colours were in two places once the robots all
// went 3D (Wan, 19 Oct 2026, "add all 3D robot as wanshah"): Robot.jsx held the
// SVG gradients and Robot3D.jsx held a hard-coded purple, so Wanshah 3 was the
// only one that could be a box. Deriving the box faces from the SAME three
// shell stops the SVG already used means a tone is defined once and both
// renderers agree by construction.
//
// shell is [light, mid, dark] — the three stops of the SVG's shell gradient.
export const THEMES = {
  afiq:   { shell: ['#2bd18a', '#0b6b3a', '#063d22'], visor: ['#0c2b1d', '#04140c'], eye: '#7dffc4', glow: '#29f0a0', accent: '#c9a227', label: 'W1', name: 'Wanshah 1' },
  mireld: { shell: ['#7fb2ff', '#2a5fc4', '#15306b'], visor: ['#0f1d3a', '#060c1c'], eye: '#9fe0ff', glow: '#5cc8ff', accent: '#f0b429', label: 'W2', name: 'Wanshah 2' },
  kios:   { shell: ['#c58bff', '#7a3fd1', '#3d1a7a'], visor: ['#25103f', '#10061f'], eye: '#f1d4ff', glow: '#d08cff', accent: '#f0b429', label: 'W3', name: 'Wanshah 3' },
}

const WHITE = '#ffffff', BLACK = '#000000'
const rgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
const hex = (c) => '#' + c.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
// a -> b by t (0..1).
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)) }

// The six faces of the body, lit from the upper front-left: the top catches a
// white tint, the bottom falls away to near-black, and the sides sit between
// the mid and dark stops so a turning box reads as one solid object. The
// fractions were fitted to the purple Wanshah 3 shipped with, so that robot
// looks the same as before and the other two now match it.
export function shadeFor(shell) {
  const [lite, mid, dark] = shell
  const midDark = mix(mid, dark, 0.5)
  return {
    front: `linear-gradient(160deg,${lite},${mid} 60%,${midDark})`,
    back: dark,
    right: `linear-gradient(90deg,${midDark},${dark})`,
    left: `linear-gradient(90deg,${mix(lite, mid, 0.75)},${mix(mid, dark, 0.26)})`,
    top: `linear-gradient(180deg,${mix(lite, WHITE, 0.45)},${mix(lite, mid, 0.25)})`,
    bottom: mix(dark, BLACK, 0.42),
  }
}

// The visor and the chest badge are the same dark glass in both renderers.
export const glassFor = (visor) => `linear-gradient(180deg,${visor[0]},${visor[1]})`

// Brushed metal and the dead-grey an offline robot goes: shared, never tinted,
// because "offline" has to look the same whichever AI it is.
export const METAL = { front: 'linear-gradient(90deg,#8a96a3,#e8edf2,#6b7785)', back: '#5b6672', right: '#6b7785', left: '#aab4bf', top: '#e8edf2', bottom: '#4b5560' }
export const GREY = { front: '#7b8088', back: '#4b5059', right: '#5a5f68', left: '#8b9098', top: '#a0a5ad', bottom: '#3a3e45' }
export const GREY_GLASS = 'linear-gradient(180deg,#3f444c,#23262b)'
