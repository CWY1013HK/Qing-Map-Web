import type { Annotation, AnnotationChgis } from '../lib/types'
import { PROVINCE_TITLES } from './provinceTitles'
import { getLocale } from './store'
import type { Locale } from './types'

export type LocalizedAnnotationFields = {
  title: string
  body?: string
  aka?: string[]
}

export function resolveAnnotation(
  annotation: Annotation,
  locale: Locale = getLocale(),
): LocalizedAnnotationFields {
  if (locale === 'zh-Hant') {
    return {
      title: annotation.title,
      body: annotation.body,
      aka: annotation.aka,
    }
  }

  const overlay = annotation.i18n?.[locale]
  return {
    title: overlay?.title ?? annotation.title,
    body: overlay?.body ?? annotation.body,
    aka: overlay?.aka ?? annotation.aka,
  }
}

/** Gazetteer link text follows the UI language instead of staying in simplified Chinese. */
export function resolveChgisName(chgis: AnnotationChgis, locale: Locale = getLocale()): string {
  if (locale === 'en') return chgis.transcription?.trim() || chgis.name
  if (locale === 'zh-Hant') return chgis.nameHant?.trim() || chgis.name
  return chgis.name
}

export function resolveProvinceTitle(
  id: string,
  canonicalTitle: string,
  locale: Locale = getLocale(),
): string {
  if (locale === 'zh-Hant') return canonicalTitle
  return PROVINCE_TITLES[id]?.[locale] ?? canonicalTitle
}
