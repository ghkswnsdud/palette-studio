/**
 * 텍스트를 클립보드에 복사합니다. 성공하면 true를 돌려줍니다.
 * 최신 Clipboard API를 먼저 시도하고, 지원하지 않는 환경에서는 예전 방식으로 복사합니다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래의 대체 방식으로 넘어갑니다.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  textarea.remove()
  return ok
}
