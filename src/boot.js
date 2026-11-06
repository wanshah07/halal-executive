// Starts the first requests for the deploy's feed snapshot (feed/, written by
// .github/split_feed.py) while the page's own code is still downloading, so a
// phone on a slow line does not wait for one before asking for the other
// (Wan, 6 Nov 2026: "make faster to load"). lib/api.js snapshotData() takes
// these promises over; without them it asks itself. Keep PARTS the same as
// ROUTE_PARTS in lib/api.js. It also preloads the code of the page the link
// opens on: the build (vite.config.js, bootFile) writes the page -> files map
// into PAGES and publishes this file as dist/boot.js. It is not part of the
// app bundle, so it stays plain ES5.
(function () {
  var route = location.hash.replace('#', '').split('/')[0] || 'overview'
  var PAGES = /*PAGES*/{}
  // Full addresses, so the app's own loader sees these links and does not add
  // its own (it looks them up by href).
  ;(PAGES[route] || []).forEach(function (f) {
    var l = document.createElement('link')
    l.rel = /\.css$/.test(f) ? 'stylesheet' : 'modulepreload'
    l.setAttribute('href', new URL(f, document.baseURI).href)
    document.head.appendChild(l)
  })
  if (!window.fetch || !window.Promise) return
  // A browser with a saved copy shows it and asks the Sheet instead (App.jsx).
  try { if (localStorage.getItem('he:data:saved')) return } catch (e) { /* no storage: ask */ }
  var PARTS = { overview: ['faq', 'news', 'events', 'certificates', 'documents', 'guidelines', 'fhcb'], faq: ['faq'], certificates: ['certificates'], guidelines: ['guidelines'], references: ['references'], documents: ['documents'], events: ['events'], fhcb: ['fhcb', 'documents'], directory: ['directory'], news: ['news'], vacancies: ['vacancies'] }
  var v = Math.floor(Date.now() / 60000)
  var get = function (name) {
    var p = fetch('./feed/' + name + '.json?t=' + v).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    p.catch(function () {})
    return p
  }
  var feed = { v: v, route: route, core: get('core'), parts: {}, chunks: {} }
  ;(PARTS[route] || []).forEach(function (p) { feed.parts[p] = get(p) })
  if (route === 'faq') feed.chunks[0] = get('faq-a-0')
  window.__heFeed = feed
})()
