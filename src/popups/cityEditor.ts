import type { Annotation, AnnotationChgis } from '../lib/types'

export type LocaleFields = {
  title: string
  body: string
  aka: string
}

export type LocaleBundle = {
  'zh-Hant': LocaleFields
  'zh-Hans': LocaleFields
  en: LocaleFields
}

export type ChgisMatch = {
  id: string
  uri: string
  name: string
  transcription: string
  featureType: string
  years: string
  parent: string
  objectType: string
  rank: number
}

export type CityEditorSave = {
  id: string
  locales: {
    'zh-Hant': { title: string; body: string; aka: string[] }
    'zh-Hans': { title: string; body: string; aka: string[] }
    en: { title: string; body: string; aka: string[] }
  }
  chgis: AnnotationChgis | null
  chgisCapital: AnnotationChgis | null
  pngBase64?: string
  point: Annotation['point']
  labelWidth?: number
  hitWidth?: number
  hitHeight?: number
}

export type CityEditorResult =
  | { action: 'saved'; annotation: Annotation; warning: string | null }
  | { action: 'deleted' }
  | { action: 'cancel' }

const LOCALE_FIELDS: { id: keyof LocaleBundle; label: string }[] = [
  { id: 'zh-Hant', label: '繁' },
  { id: 'zh-Hans', label: '简' },
  { id: 'en', label: 'EN' },
]

function akaText(names: string[] | undefined): string {
  return (names ?? []).filter(Boolean).join('、')
}

function parseAka(value: string): string[] {
  return value
    .split(/[、,，]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function fieldsFrom(annotation: Annotation): LocaleBundle {
  return {
    'zh-Hant': {
      title: annotation.title ?? '',
      body: annotation.body ?? '',
      aka: akaText(annotation.aka),
    },
    'zh-Hans': {
      title: annotation.i18n?.['zh-Hans']?.title ?? '',
      body: annotation.i18n?.['zh-Hans']?.body ?? '',
      aka: akaText(annotation.i18n?.['zh-Hans']?.aka),
    },
    en: {
      title: annotation.i18n?.en?.title ?? '',
      body: annotation.i18n?.en?.body ?? '',
      aka: akaText(annotation.i18n?.en?.aka),
    },
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function openCityEditor(opts: {
  mode: 'insert' | 'update'
  annotation: Annotation
  pngBase64?: string
  onSave: (payload: CityEditorSave) => Promise<{ annotation: Annotation; warning: string | null }>
  onDelete?: () => Promise<void>
}): Promise<CityEditorResult> {
  const { mode, annotation, pngBase64 } = opts
  const fields = fieldsFrom(annotation)
  let idTouched = mode === 'update' || Boolean(annotation.id)
  let selectedChgis: AnnotationChgis | null = annotation.chgis ?? null
  let selectedCapital: AnnotationChgis | null = annotation.chgisCapital ?? null
  let matches: ChgisMatch[] = []
  let capitalMatches: ChgisMatch[] = []
  let searchSerial = 0
  let capitalSerial = 0
  let confirmOpen = false

  const root = el('div', 'city-editor')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-labelledby', 'city-editor-heading')

  const panel = el('form', 'city-editor-panel')
  panel.addEventListener('submit', (event) => {
    event.preventDefault()
    void commit()
  })

  const heading = el('h2', 'city-editor-heading', mode === 'insert' ? 'New city' : 'Edit entry')
  heading.id = 'city-editor-heading'
  panel.appendChild(heading)

  if (pngBase64 || annotation.labelImage) {
    const preview = el('img', 'city-editor-preview')
    preview.alt = ''
    preview.src = pngBase64 ? `data:image/png;base64,${pngBase64}` : (annotation.labelImage as string)
    panel.appendChild(preview)
  }

  const idRow = el('label', 'city-editor-field')
  idRow.append(el('span', 'city-editor-label', 'Id'), document.createTextNode(' '))
  const idInput = el('input') as HTMLInputElement
  idInput.value = annotation.id
  idInput.required = true
  idInput.spellcheck = false
  idInput.autocomplete = 'off'
  idInput.readOnly = mode === 'update'
  idInput.pattern = '[A-Za-z0-9-]+'
  idInput.addEventListener('input', () => {
    idTouched = true
  })
  idRow.appendChild(idInput)
  panel.appendChild(idRow)

  const inputs = {} as Record<keyof LocaleBundle, { title: HTMLInputElement; body: HTMLTextAreaElement; aka: HTMLInputElement }>

  for (const locale of LOCALE_FIELDS) {
    const group = el('fieldset', 'city-editor-locale')
    const legend = el('legend', undefined, locale.label)
    group.appendChild(legend)
    const title = el('input') as HTMLInputElement
    title.value = fields[locale.id].title
    title.placeholder = 'Title'
    const body = el('textarea') as HTMLTextAreaElement
    body.value = fields[locale.id].body
    body.rows = 3
    body.placeholder = 'Body'
    const aka = el('input') as HTMLInputElement
    aka.value = fields[locale.id].aka
    aka.placeholder = 'Aka, separated by 、'
    group.append(fieldLine('Title', title), fieldLine('Body', body), fieldLine('Aka', aka))
    inputs[locale.id] = { title, body, aka }
    panel.appendChild(group)
  }

  const chgisBlock = el('fieldset', 'city-editor-chgis')
  chgisBlock.appendChild(el('legend', undefined, 'CHGIS'))
  const chgisList = el('div', 'city-editor-chgis-list')
  const chgisStatus = el('p', 'city-editor-hint', 'Type a title to search the 1820 gazetteer.')
  chgisBlock.append(chgisList, chgisStatus)
  panel.appendChild(chgisBlock)

  const capitalBlock = el('fieldset', 'city-editor-chgis')
  capitalBlock.appendChild(el('legend', undefined, '省會'))
  const capitalList = el('div', 'city-editor-chgis-list')
  const capitalStatus = el('p', 'city-editor-hint', 'Add 省會 names to search for the capital.')
  capitalBlock.append(capitalList, capitalStatus)
  panel.appendChild(capitalBlock)

  const status = el('p', 'city-editor-status')
  status.dataset.kind = 'idle'
  panel.appendChild(status)

  const actions = el('div', 'city-editor-actions')
  const saveBtn = el('button', 'city-editor-save', mode === 'insert' ? 'Insert' : 'Save') as HTMLButtonElement
  saveBtn.type = 'submit'
  const deleteBtn = el('button', 'city-editor-delete', 'Delete') as HTMLButtonElement
  deleteBtn.type = 'button'
  deleteBtn.hidden = mode !== 'update'
  const cancelBtn = el('button', 'city-editor-cancel', 'Cancel') as HTMLButtonElement
  cancelBtn.type = 'button'
  actions.append(saveBtn, deleteBtn, cancelBtn)
  panel.appendChild(actions)

  const confirm = el('div', 'city-editor-confirm')
  confirm.hidden = true
  const captured = annotation.tags?.includes('city-capture')
  confirm.append(
    el('p', 'city-editor-confirm-title', 'Delete this entry?'),
    el(
      'p',
      'city-editor-hint',
      captured
        ? 'This removes it from the map and deletes the captured label image.'
        : 'This removes it from the map. The hand-cut label image stays on disk.',
    ),
  )
  const confirmActions = el('div', 'city-editor-actions')
  const confirmDelete = el('button', 'city-editor-delete', 'Delete') as HTMLButtonElement
  confirmDelete.type = 'button'
  const confirmCancel = el('button', 'city-editor-cancel', 'Cancel') as HTMLButtonElement
  confirmCancel.type = 'button'
  confirmActions.append(confirmDelete, confirmCancel)
  confirm.appendChild(confirmActions)
  panel.appendChild(confirm)

  root.appendChild(panel)
  document.querySelector('#app')?.appendChild(root)

  const setStatus = (message: string, kind: 'idle' | 'ok' | 'err' | 'busy') => {
    status.textContent = message
    status.dataset.kind = kind
  }

  const setBusy = (busy: boolean) => {
    saveBtn.disabled = busy
    deleteBtn.disabled = busy
    cancelBtn.disabled = busy
    idInput.disabled = busy
  }

  function readLocales(): CityEditorSave['locales'] {
    const read = (id: keyof LocaleBundle) => ({
      title: inputs[id].title.value,
      body: inputs[id].body.value,
      aka: parseAka(inputs[id].aka.value),
    })
    return {
      'zh-Hant': read('zh-Hant'),
      'zh-Hans': read('zh-Hans'),
      en: read('en'),
    }
  }

  function renderMatchList(
    list: HTMLElement,
    group: string,
    rows: ChgisMatch[],
    selected: AnnotationChgis | null,
    onPick: (record: AnnotationChgis | null, suggest: boolean) => void,
  ) {
    list.replaceChildren()
    list.appendChild(radioRow(group, null, 'No link', selected == null, () => onPick(null, false)))
    for (const match of rows) {
      const bits = [match.name, match.featureType, match.years, match.parent, match.transcription]
        .map((part) => part.trim())
        .filter(Boolean)
      list.appendChild(
        radioRow(group, match, bits.join(' · '), selected?.id === match.id, () => onPick(fromMatch(match), group === 'city-chgis')),
      )
    }
  }

  function renderMatches() {
    renderMatchList(chgisList, 'city-chgis', matches, selectedChgis, (record, suggest) => {
      selectedChgis = record
      if (suggest && record?.transcription) suggestId(record.transcription)
    })
  }

  function renderCapital() {
    renderMatchList(capitalList, 'city-chgis-capital', capitalMatches, selectedCapital, (record) => {
      selectedCapital = record
    })
  }

  function radioRow(
    group: string,
    match: ChgisMatch | null,
    label: string,
    checked: boolean,
    onPick: () => void,
  ): HTMLLabelElement {
    const row = el('label', 'city-editor-choice')
    const input = el('input') as HTMLInputElement
    input.type = 'radio'
    input.name = group
    input.value = match?.id ?? ''
    input.checked = checked
    input.addEventListener('change', () => {
      if (!input.checked) return
      onPick()
    })
    row.append(input, el('span', undefined, label))
    return row
  }

  function fromMatch(match: ChgisMatch): AnnotationChgis {
    return {
      id: match.id,
      uri: match.uri,
      name: match.name,
      transcription: match.transcription || undefined,
    }
  }

  function suggestId(transcription: string) {
    if (idTouched || mode === 'update') return
    const slug = slugify(transcription)
    if (slug) idInput.value = slug
  }

  async function searchChgis() {
    const locales = readLocales()
    const name = locales['zh-Hant'].title || locales['zh-Hans'].title || locales.en.title
    const serial = ++searchSerial
    if (!name.trim()) {
      matches = []
      chgisStatus.textContent = 'Type a title to search the 1820 gazetteer.'
      renderMatches()
      return
    }
    chgisStatus.textContent = 'Searching CHGIS…'
    try {
      const params = new URLSearchParams({ n: name.trim() })
      const res = await fetch(`/__dev/annotations/chgis?${params}`)
      const data = await res.json()
      if (serial !== searchSerial) return
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'CHGIS search failed')
      matches = data.matches ?? []
      prependSaved(matches, annotation.chgis)
      const selectedId = data.selectedId as string | null
      const stillListed = selectedChgis != null && matches.some((match) => match.id === selectedChgis?.id)
      if (stillListed) {
        /* keep the record already chosen for this entry */
      } else if (selectedId) {
        const hit = matches.find((match) => match.id === selectedId)
        selectedChgis = hit
          ? {
              id: hit.id,
              uri: hit.uri,
              name: hit.name,
              transcription: hit.transcription || undefined,
            }
          : null
        if (hit?.transcription) suggestId(hit.transcription)
      } else {
        selectedChgis = null
      }
      chgisStatus.textContent = matches.length
        ? selectedId
          ? 'One record matched. Change it if this is the wrong place.'
          : 'Several records matched. Choose one.'
        : 'No 1820 record for that name.'
      renderMatches()
    } catch (err) {
      if (serial !== searchSerial) return
      chgisStatus.textContent = err instanceof Error ? err.message : String(err)
      matches = []
      renderMatches()
    }
  }

  async function searchCapital() {
    const locales = readLocales()
    const aka = locales['zh-Hant'].aka.length ? locales['zh-Hant'].aka : locales['zh-Hans'].aka
    const province = [selectedChgis?.name, locales['zh-Hant'].title, locales['zh-Hans'].title]
      .filter(Boolean)
      .join(',')
    const serial = ++capitalSerial
    if (!aka.length) {
      capitalMatches = []
      capitalStatus.textContent = 'Add 省會 names to search for the capital.'
      renderCapital()
      return
    }
    capitalStatus.textContent = 'Searching CHGIS…'
    try {
      const params = new URLSearchParams({ capital: '1', province, aka: aka.join(',') })
      const res = await fetch(`/__dev/annotations/chgis?${params}`)
      const data = await res.json()
      if (serial !== capitalSerial) return
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'CHGIS search failed')
      capitalMatches = data.matches ?? []
      prependSaved(capitalMatches, annotation.chgisCapital)
      const selectedId = data.selectedId as string | null
      const stillListed = selectedCapital != null && capitalMatches.some((match) => match.id === selectedCapital?.id)
      if (!stillListed) {
        const hit = capitalMatches.find((match) => match.id === selectedId)
        selectedCapital = hit ? fromMatch(hit) : null
      }
      capitalStatus.textContent = capitalMatches.length
        ? selectedId
          ? 'One prefecture sits under this province. Change it if this is the wrong seat.'
          : 'Several prefectures matched. Choose the capital.'
        : 'No prefecture for those 省會 names.'
      renderCapital()
    } catch (err) {
      if (serial !== capitalSerial) return
      capitalStatus.textContent = err instanceof Error ? err.message : String(err)
      capitalMatches = []
      renderCapital()
    }
  }

  function prependSaved(rows: ChgisMatch[], saved: AnnotationChgis | undefined) {
    if (!saved || rows.some((match) => match.id === saved.id)) return
    rows.unshift({
      id: saved.id,
      uri: saved.uri,
      name: saved.name,
      transcription: saved.transcription ?? '',
      featureType: '',
      years: '',
      parent: 'Saved link',
      objectType: '',
      rank: 0,
    })
  }

  let searchTimer = 0
  let capitalTimer = 0
  const scheduleSearch = () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      void searchChgis()
    }, 320)
  }
  const scheduleCapital = () => {
    window.clearTimeout(capitalTimer)
    capitalTimer = window.setTimeout(() => {
      void searchCapital()
    }, 320)
  }
  for (const locale of LOCALE_FIELDS) {
    inputs[locale.id].title.addEventListener('input', () => {
      scheduleSearch()
      scheduleCapital()
    })
    inputs[locale.id].aka.addEventListener('input', scheduleCapital)
  }

  function close(result: CityEditorResult) {
    window.clearTimeout(searchTimer)
    window.clearTimeout(capitalTimer)
    document.removeEventListener('keydown', onKey)
    root.remove()
    finish(result)
  }

  async function commit() {
    const id = idInput.value.trim()
    if (!/^[a-z0-9-]+$/i.test(id)) {
      setStatus('Id must be letters, numbers, and hyphens.', 'err')
      idInput.focus()
      return
    }
    setBusy(true)
    setStatus(mode === 'insert' ? 'Inserting…' : 'Saving…', 'busy')
    try {
      const saved = await opts.onSave({
        id,
        locales: readLocales(),
        chgis: selectedChgis,
        chgisCapital: selectedCapital,
        pngBase64,
        point: annotation.point,
        labelWidth: annotation.labelWidth,
        hitWidth: annotation.hitWidth,
        hitHeight: annotation.hitHeight,
      })
      close({ action: 'saved', annotation: saved.annotation, warning: saved.warning })
    } catch (err) {
      setBusy(false)
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  async function commitDelete() {
    if (!opts.onDelete) return
    setBusy(true)
    setStatus('Deleting…', 'busy')
    try {
      await opts.onDelete()
      close({ action: 'deleted' })
    } catch (err) {
      setBusy(false)
      confirm.hidden = true
      confirmOpen = false
      setStatus(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  deleteBtn.addEventListener('click', () => {
    confirmOpen = true
    confirm.hidden = false
    confirmDelete.focus()
  })
  confirmCancel.addEventListener('click', () => {
    confirmOpen = false
    confirm.hidden = true
  })
  confirmDelete.addEventListener('click', () => {
    void commitDelete()
  })
  cancelBtn.addEventListener('click', () => close({ action: 'cancel' }))

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (confirmOpen) {
      confirmOpen = false
      confirm.hidden = true
      return
    }
    close({ action: 'cancel' })
  }
  document.addEventListener('keydown', onKey)

  let finish: (result: CityEditorResult) => void = () => {}
  const done = new Promise<CityEditorResult>((resolve) => {
    finish = resolve
  })

  renderMatches()
  renderCapital()
  void searchChgis()
  void searchCapital()
  window.setTimeout(() => {
    if (mode === 'insert') inputs['zh-Hant'].title.focus()
    else inputs['zh-Hant'].title.focus()
  }, 0)

  return done
}

function fieldLine(label: string, control: HTMLElement): HTMLLabelElement {
  const row = el('label', 'city-editor-field')
  row.append(el('span', 'city-editor-label', label), control)
  return row
}
