/** Intro curtain + cloud scatter after the seal click (before qing-map-intro-done). */
export function isIntroSequence(): boolean {
  const app = document.getElementById('app')
  if (app?.classList.contains('intro-active')) return true
  const intro = document.querySelector('.intro')
  return intro?.classList.contains('is-scattering') === true
}
