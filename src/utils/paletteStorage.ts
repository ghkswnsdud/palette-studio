// 팔레트를 브라우저 LocalStorage에 저장하고 불러오는 기능입니다.
// 저장된 값은 언제든 손상되거나 사용자가 직접 고칠 수 있으므로,
// 읽을 때마다 형식을 검사하고 잘못된 항목은 걸러 냅니다.

import { normalizeHex } from './color'
import { createId } from './id'

/** 저장되는 팔레트 하나의 형식 */
export interface SavedPalette {
  id: string
  name: string
  /** '#RRGGBB' 색상 코드 배열 */
  colors: string[]
  /** colors와 같은 순서의 색상별 비율 (0~1, 직접 추가한 색은 0) */
  ratios: number[]
  /** ISO 8601 형식 시각 (예: '2026-10-24T05:30:00.000Z') */
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'palette-studio:palettes:v1'
/** 손상된 저장 데이터를 지우지 않고 옮겨 두는 곳 (복구용) */
const BACKUP_KEY = 'palette-studio:palettes:corrupted-backup'
const FILE_FORMAT = 'palette-studio'
const FILE_VERSION = 1
export const MAX_COLORS = 30

/** 사용자에게 그대로 보여 줄 수 있는 안내 문구를 담은 오류 */
export class PaletteDataError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isValidDate = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))

/** 알 수 없는 값을 검사해 올바른 팔레트면 정리된 값을, 아니면 null을 돌려줍니다. */
export function parsePalette(value: unknown): SavedPalette | null {
  if (!isRecord(value)) return null
  const { id, name, colors, ratios, createdAt, updatedAt } = value
  if (typeof id !== 'string' || id.trim() === '') return null
  if (typeof name !== 'string') return null
  if (!Array.isArray(colors) || colors.length === 0 || colors.length > MAX_COLORS) return null
  if (!Array.isArray(ratios) || ratios.length !== colors.length) return null
  if (!isValidDate(createdAt) || !isValidDate(updatedAt)) return null

  const hexes: string[] = []
  for (const c of colors) {
    const hex = typeof c === 'string' ? normalizeHex(c) : null
    if (!hex) return null
    hexes.push(hex)
  }
  for (const r of ratios) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 1) return null
  }
  return {
    id,
    name: name.trim() || '이름 없는 팔레트',
    colors: hexes,
    ratios: ratios as number[],
    createdAt,
    updatedAt,
  }
}

export interface LoadResult {
  palettes: SavedPalette[]
  /** 문제가 있었다면 사용자 안내 문구 */
  error: string | null
}

/** LocalStorage에서 저장된 팔레트 목록을 읽습니다. 실패해도 앱이 멈추지 않습니다. */
export function loadPalettes(): LoadResult {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { palettes: [], error: '브라우저 저장소를 사용할 수 없습니다. (개인정보 보호 모드인지 확인해 주세요)' }
  }
  if (raw === null) return { palettes: [], error: null }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    data = null
  }
  if (!Array.isArray(data)) {
    // 망가진 데이터는 다음 저장 때 덮어쓰이지 않도록 백업해 둡니다.
    try {
      localStorage.setItem(BACKUP_KEY, raw)
    } catch {
      // 백업 실패는 무시합니다.
    }
    return { palettes: [], error: '저장된 팔레트 데이터가 손상되어 불러오지 못했습니다.' }
  }

  const palettes = data.map(parsePalette).filter((p): p is SavedPalette => p !== null)
  const skipped = data.length - palettes.length
  return {
    palettes,
    error: skipped > 0 ? `잘못된 형식의 팔레트 ${skipped}개를 제외하고 불러왔습니다.` : null,
  }
}

/** 저장소가 가득 찼을 때 브라우저마다 다르게 던지는 오류를 판별합니다. */
function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  )
}

/** 팔레트 목록 전체를 저장합니다. 실패하면 안내 문구를 돌려줍니다. */
export function savePalettes(palettes: SavedPalette[]): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes))
    return null
  } catch (error) {
    if (isQuotaError(error)) {
      return '저장 공간이 부족합니다. 사용하지 않는 팔레트를 삭제한 뒤 다시 시도해 주세요.'
    }
    return '팔레트를 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.'
  }
}

/** 새로 저장할 팔레트를 만듭니다. */
export function createPalette(name: string, colors: string[], ratios: number[]): SavedPalette {
  const now = new Date().toISOString()
  return { id: createId('palette'), name, colors, ratios, createdAt: now, updatedAt: now }
}

/** 내보낼 JSON 문자열을 만듭니다. 파일 형식을 알아볼 수 있도록 표시를 붙입니다. */
export function palettesToJson(palettes: SavedPalette[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, palettes }, null, 2)
}

/**
 * 가져온 JSON 문자열을 팔레트 목록으로 바꿉니다.
 * 이 앱에서 내보낸 형식, 팔레트 배열, 팔레트 하나를 모두 받습니다.
 */
export function parseImportedJson(text: string): SavedPalette[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new PaletteDataError('JSON 형식이 올바르지 않은 파일입니다.')
  }

  let items: unknown[]
  if (Array.isArray(data)) items = data
  else if (isRecord(data) && Array.isArray(data.palettes)) items = data.palettes
  else if (isRecord(data)) items = [data]
  else throw new PaletteDataError('팔레트 데이터를 찾을 수 없습니다.')

  const palettes = items.map(parsePalette).filter((p): p is SavedPalette => p !== null)
  if (palettes.length === 0) {
    throw new PaletteDataError('올바른 팔레트가 없습니다. 색상 코드와 비율 형식을 확인해 주세요.')
  }
  return palettes
}
