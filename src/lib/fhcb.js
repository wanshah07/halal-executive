import seed from '../data/fhcb.json'

// The FHCB list the page shows: the Sheet's rows plus any bundled row (the
// JAKIM MyIHAB list, 101 bodies in 51 countries) the Sheet does not have yet, so
// the list, the map and the counts always tally with JAKIM's own page without
// anyone pressing Admin → Load (Wan, 25 Oct 2026). A row Admin deleted is
// remembered in Settings seed_deleted and never comes back. A row Admin edited
// keeps its id, so the Sheet's version wins.
export const fhcbRows = (data) => {
  const live = ((data && data.fhcb) || []).filter((r) => r.status !== 'hidden')
  if (!live.length) return seed
  let gone = []
  try { gone = JSON.parse(((data && data.settings) || {}).seed_deleted || '[]') } catch { gone = [] }
  const have = new Set(((data && data.fhcb) || []).map((r) => String(r.id)))
  return [...live, ...seed.filter((r) => !have.has(String(r.id)) && !gone.includes('FHCB:' + r.id))]
}
