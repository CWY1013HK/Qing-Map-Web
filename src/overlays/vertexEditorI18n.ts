import { registerLocaleRefresh, t } from '../i18n'

type VertexEditorI18nRefs = {
  panel: HTMLElement
  modeEl: HTMLSelectElement
  hintEl: HTMLElement
  provinceRow: HTMLElement
  labelRow: HTMLElement
  annotationRow: HTMLElement
  eraseHint: HTMLElement
  overlayLabel: HTMLElement
  ringLabel: HTMLElement
  toggleLabel: HTMLElement
  saveShortcut: HTMLElement
  syncSaveUi: () => void
  getStatusKind: () => string | undefined
  refreshStatusForMode: () => void
}

export function bindVertexEditorI18n(refs: VertexEditorI18nRefs): void {
  const apply = () => {
    refs.toggleLabel.textContent = t('vertex.toggleEdit')
    refs.modeEl.options[0].textContent = t('vertex.mode.vertices')
    refs.modeEl.options[1].textContent = t('vertex.mode.overlays')
    refs.modeEl.options[2].textContent = t('vertex.mode.labels')
    refs.modeEl.options[3].textContent = t('vertex.mode.annotations')
    const modeLabel = refs.panel.querySelector<HTMLElement>('#vertex-edit-mode-wrap')
    if (modeLabel) {
      const label = modeLabel.querySelector('span')
      if (label) label.textContent = t('vertex.modeLabel')
    }
    refs.hintEl.textContent = t('vertex.hint.vertices')
    const provinceHint = refs.provinceRow.querySelector('.vertex-editor-hint')
    if (provinceHint) provinceHint.textContent = t('vertex.hint.province')
    const labelHint = refs.labelRow.querySelector('.vertex-editor-hint')
    if (labelHint) labelHint.textContent = t('vertex.hint.labelBox')
    const annotHint = refs.annotationRow.querySelector('.vertex-editor-hint')
    if (annotHint) annotHint.textContent = t('vertex.hint.annotation')
    refs.eraseHint.innerHTML = t('vertex.hint.erase').replaceAll('D', '<kbd>D</kbd>')
    refs.overlayLabel.textContent = t('vertex.overlayLabel')
    refs.ringLabel.textContent = t('vertex.ringLabel')
    refs.saveShortcut.textContent = t('vertex.saveShortcut')
    refs.syncSaveUi()
    const kind = refs.getStatusKind()
    if (kind === 'idle' || kind === 'busy' || kind === undefined) {
      refs.refreshStatusForMode()
    }
  }
  apply()
  registerLocaleRefresh(apply)
}

export function vertexSaveLabel(count: number): string {
  return count > 1 ? t('vertex.saveMany').replace('{n}', String(count)) : t('vertex.save')
}

export function vertexSavedFiles(files: string): string {
  return t('vertex.status.saved').replace('{files}', files)
}

export function vertexErasedStatus(removed: number, left: number): string {
  return t('vertex.status.erased').replace('{n}', String(removed)).replace('{left}', String(left))
}
