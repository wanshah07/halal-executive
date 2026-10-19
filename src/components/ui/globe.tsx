import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// A turning Earth (NASA Blue Marble, public/brand/earth.jpg) drawn in one
// WebGL pass: the fragment shader finds, for every pixel of the disc, the
// longitude and latitude it shows and reads the picture there, so there is no
// mesh and no 3D library. It replaces the cobe dot-globe (Wan, 18 Oct 2026:
// "not black, auto rotate, like actual earth"): cobe draws a monochrome dot
// map, and its shader rendered black on software GL.
//
// It starts facing Malaysia, turns west to east by itself, can be dragged,
// holds still for visitors who ask for reduced motion, and stops drawing while
// off screen. With no WebGL a CSS version of the same picture scrolls inside a
// circle, so the card is never empty.
export type GlobeMarker = { location: [number, number]; size: number } // [lat, lon] degrees

const EARTH = "./brand/earth.jpg"
const FACING: [number, number] = [3.14, 101.69] // Kuala Lumpur
const MAX_MARKERS = 40
const DEG = Math.PI / 180

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uPhi; uniform float uTheta; uniform sampler2D uTex;
uniform vec4 uMarks[${MAX_MARKERS}]; uniform float uN;
const float R = 0.86;
void main(){
  vec2 p = (gl_FragCoord.xy / uRes * 2.0 - 1.0) / R;
  float r = length(p);
  vec3 col = vec3(0.0); float alpha = 0.0;
  if (r < 1.0) {
    vec3 n = vec3(p, sqrt(1.0 - r * r));
    float ct = cos(uTheta), st = sin(uTheta);
    vec3 a = vec3(n.x, n.y * ct + n.z * st, -n.y * st + n.z * ct);
    float cp = cos(uPhi), sp = sin(uPhi);
    vec3 g = vec3(a.x * cp - a.z * sp, a.y, a.x * sp + a.z * cp);
    vec2 uv = vec2(atan(g.x, g.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(g.y, -1.0, 1.0)) / 3.1415927);
    vec3 t = texture2D(uTex, uv).rgb;
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float lit = 0.92 + 0.16 * max(dot(n, L), 0.0); // nearly flat: no dark side, no shadow
    col = t * lit;
    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      if (float(i) >= uN) break;
      vec4 m = uMarks[i];
      vec3 mp = vec3(cos(m.x) * sin(m.y), sin(m.x), cos(m.x) * cos(m.y));
      float d = distance(g, mp);
      col = mix(col, vec3(1.0), smoothstep(m.z * 1.9, m.z * 1.5, d) * 0.55);
      col = mix(col, vec3(0.96, 0.62, 0.04), smoothstep(m.z, m.z * 0.7, d));
    }
    alpha = 1.0 - smoothstep(0.992, 1.0, r);
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader")
  return s
}

export function Globe({
  className,
  markers = [],
  facing = FACING,
}: {
  className?: string
  markers?: GlobeMarker[]
  facing?: [number, number] // [lat, lon] the globe starts on
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; phi: number } | null>(null)
  const [flat, setFlat] = useState(false)
  const [epoch, setEpoch] = useState(0) // bumped when the browser gives the GL context back after losing it
  // The effect restarts only when the pins or the facing really change. It used
  // to restart on every render (a new array each time), and its cleanup lost the
  // GL context: after a language switch or a refresh the globe stood still, and
  // on a phone, where the page re-renders more, it hardly ever turned (Wan,
  // 19 Oct 2026).
  const pinKey = JSON.stringify(markers.map((m) => [m.location[0], m.location[1], m.size]))
  const markersRef = useRef(markers); markersRef.current = markers
  const faceKey = facing.join(",")
  const phiRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let gl: WebGLRenderingContext | null = null
    try {
      gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false })
    } catch { gl = null }
    if (!gl) { setFlat(true); return }
    const g = gl

    let prog: WebGLProgram, loc: Record<string, WebGLUniformLocation | null>
    try {
      prog = g.createProgram()!
      g.attachShader(prog, compile(g, g.VERTEX_SHADER, VERT))
      g.attachShader(prog, compile(g, g.FRAGMENT_SHADER, FRAG))
      g.linkProgram(prog)
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error("link")
    } catch { setFlat(true); return }
    g.useProgram(prog)
    const buf = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
    const a = g.getAttribLocation(prog, "a")
    g.enableVertexAttribArray(a)
    g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0)
    loc = Object.fromEntries(["uRes", "uPhi", "uTheta", "uTex", "uMarks", "uN"].map((k) => [k, g.getUniformLocation(prog, k)]))

    const list = markersRef.current.slice(0, MAX_MARKERS)
    const flatMarks = new Float32Array(MAX_MARKERS * 4)
    list.forEach((m, i) => flatMarks.set([m.location[0] * DEG, m.location[1] * DEG, m.size * 0.55, 0], i * 4))
    g.uniform4fv(loc.uMarks, flatMarks)
    g.uniform1f(loc.uN, list.length)
    g.uniform1f(loc.uTheta, Math.max(0.12, Math.min(0.6, facing[0] * DEG + 0.28)))

    let phi = phiRef.current ?? -facing[1] * DEG // centre longitude = -phi; kept when the pins change
    let live = false, visible = true, raf = 0, last = 0, ready = false, lastFrame = performance.now()
    // Reduced motion slows the turn to a drift (a quarter of the speed) rather
    // than freezing it: a phone with that setting on showed a dead picture.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const still = false

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      g.viewport(0, 0, w, h)
      g.uniform2f(loc.uRes, w, h)
    }
    const draw = (now: number) => {
      raf = 0
      if (!live) return
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
      last = now; lastFrame = performance.now()
      if (!drag.current) phi += dt * (calm ? 0.05 : 0.2)
      size()
      phiRef.current = phi
      g.uniform1f(loc.uPhi, phi)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      g.drawArrays(g.TRIANGLES, 0, 3)
      if (!ready) { ready = true; canvas.style.opacity = "1" }
      if (visible && !still) raf = requestAnimationFrame(draw)
    }
    const kick = () => { if (!raf && live) { last = 0; raf = requestAnimationFrame(draw) } }

    const img = new Image()
    img.onload = () => {
      const tex = g.createTexture()
      g.bindTexture(g.TEXTURE_2D, tex)
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.uniform1i(loc.uTex, 0)
      live = true
      kick()
    }
    img.onerror = () => setFlat(true)
    img.src = EARTH

    const io = "IntersectionObserver" in window ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick() }) : null
    io?.observe(canvas)
    const onResize = () => { if (live && (still || !raf)) { last = 0; requestAnimationFrame(draw) } }
    window.addEventListener("resize", onResize)
    const onShow = () => { if (!document.hidden) kick() }
    document.addEventListener("visibilitychange", onShow)
    window.addEventListener("pageshow", onShow)
    // A phone takes the GL context away when the tab is in the background; it
    // is given back later and the whole scene is built again.
    const onLost = (e: Event) => { e.preventDefault(); live = false; cancelAnimationFrame(raf); raf = 0 }
    const onRestored = () => setEpoch((n) => n + 1)
    canvas.addEventListener("webglcontextlost", onLost)
    canvas.addEventListener("webglcontextrestored", onRestored)
    // A frame has not been drawn for 2 s while the globe is on screen: start again.
    const dog = window.setInterval(() => { if (live && visible && !document.hidden && performance.now() - lastFrame > 2000) { last = 0; if (raf) cancelAnimationFrame(raf); raf = 0; kick() } }, 1000)

    // Dragging turns the globe by the distance moved; it carries on from there.
    const onDown = (e: PointerEvent) => { drag.current = { x: e.clientX, phi }; canvas.setPointerCapture?.(e.pointerId); canvas.style.cursor = "grabbing" }
    const onMove = (e: PointerEvent) => { if (drag.current) { phi = drag.current.phi + (e.clientX - drag.current.x) / (canvas.clientWidth * 0.43); if (still) kick() } }
    const onUp = () => { drag.current = null; canvas.style.cursor = "grab" }
    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("pointercancel", onUp)

    return () => {
      live = false
      cancelAnimationFrame(raf)
      io?.disconnect()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onShow)
      window.removeEventListener("pageshow", onShow)
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      window.clearInterval(dog)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      // The context is kept (the next run reuses this canvas); only what this
      // run made is released.
      try { g.deleteProgram(prog); g.deleteBuffer(buf) } catch { /* context already gone */ }
    }
  }, [pinKey, faceKey, epoch])

  return (
    <div className={cn("absolute inset-0 mx-auto aspect-[1/1] w-full max-w-[600px]", className)}>
      {flat ? (
        <div className="absolute inset-[7%] overflow-hidden rounded-full">
          <div className="earth-flat size-full" style={{ backgroundImage: `url(${EARTH})` }} />
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.25),rgba(0,0,0,0)_60%,rgba(0,0,0,0)_100%)]" />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="size-full opacity-0 transition-opacity duration-500 [contain:layout_paint_size]"
          style={{ touchAction: "pan-y", cursor: "grab" }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
