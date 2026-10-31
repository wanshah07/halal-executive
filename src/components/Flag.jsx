import { Globe, ICON } from './Icon'
import { flagCode } from '../lib/config'

// A country's flag as a small picture (public/flags/<iso>.svg), 4:3, with a thin ring so a
// white flag keeps its edge. A country with no flag file yet shows a globe, never a gap.
export default function Flag({ country, className = '' }) {
  const code = flagCode(country)
  if (!code) return <Globe {...ICON} size={14} className={`inline-block shrink-0 text-ink-400 ${className}`} />
  return <img src={`./flags/${code}.svg`} alt="" width="20" height="15" loading="lazy" decoding="async" className={`inline-block h-[15px] w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-black/15 ${className}`} />
}
