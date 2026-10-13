import type { Locale } from '../i18n'
import jiaqingHant from '../../data/narration/jiaqing-1812/zh-Hant.md?raw'
import jiaqingHans from '../../data/narration/jiaqing-1812/zh-Hans.md?raw'
import jiaqingEn from '../../data/narration/jiaqing-1812/en.md?raw'
import jiaqingTour from '../../data/transitions/jiaqing-1812.json'
import type { TourDefinition } from './types'

const RAW: Record<string, Partial<Record<Locale, string>>> = {
  'jiaqing-1812': {
    'zh-Hant': jiaqingHant,
    'zh-Hans': jiaqingHans,
    en: jiaqingEn,
  },
}

export const TOURS: TourDefinition[] = [jiaqingTour as TourDefinition]

export function getTourById(id: string): TourDefinition | undefined {
  return TOURS.find((t) => t.id === id)
}

export function getRawNarration(tourId: string, locale: Locale): string | null {
  const pack = RAW[tourId]
  if (!pack) return null
  return pack[locale] ?? pack['zh-Hant'] ?? null
}
