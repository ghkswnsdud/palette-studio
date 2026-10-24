let counter = 0

/** 화면 요소를 구분하기 위한 고유 id를 만듭니다. */
export function createId(prefix = 'id'): string {
  counter++
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}
