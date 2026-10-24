// 무드보드 프로젝트와 참고 이미지를 IndexedDB에 저장합니다.
//
// 왜 LocalStorage가 아니라 IndexedDB인가?
// - LocalStorage는 보통 사이트당 약 5MB, 문자열만 저장할 수 있습니다.
//   이미지를 넣으려면 base64 문자열로 바꿔야 해서 용량이 약 33% 늘어나고,
//   읽고 쓰는 동안 화면이 멈춥니다(동기 방식).
// - IndexedDB는 이미지를 Blob(파일 데이터) 그대로 저장하고, 보통 수백 MB 이상을 쓸 수 있으며,
//   비동기로 동작해 화면을 멈추지 않습니다.
// - 프로젝트와 이미지를 한 데이터베이스에 두면, 프로젝트 삭제 시 그 이미지들까지
//   하나의 트랜잭션으로 함께 지울 수 있어 쓰레기 데이터가 남지 않습니다.

import type { BoardItem, MoodboardProject } from '../types'
import { normalizeHex } from './color'

const DB_NAME = 'palette-studio'
const DB_VERSION = 1
const PROJECTS = 'projects'
const IMAGES = 'images'

/** IndexedDB에 저장되는 참고 이미지 */
export interface StoredImage {
  id: string
  projectId: string
  blob: Blob
  width: number
  height: number
  createdAt: string
}

/** 사용자에게 그대로 보여 줄 수 있는 안내 문구를 담은 오류 */
export class StorageError extends Error {}

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new StorageError('저장 공간이 부족합니다. 사용하지 않는 프로젝트나 이미지를 삭제해 주세요.')
  }
  return new StorageError('무드보드를 저장하거나 불러오지 못했습니다.')
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('이 브라우저는 IndexedDB를 지원하지 않아 무드보드를 저장할 수 없습니다.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // 처음 열 때(또는 버전이 올라갈 때) 저장소 구조를 만듭니다.
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(IMAGES)) {
        const images = db.createObjectStore(IMAGES, { keyPath: 'id' })
        images.createIndex('projectId', 'projectId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new StorageError('브라우저 저장소를 열 수 없습니다. (개인정보 보호 모드인지 확인해 주세요)'))
    request.onblocked = () =>
      reject(new StorageError('다른 탭에서 앱이 열려 있어 저장소를 열 수 없습니다. 다른 탭을 닫아 주세요.'))
  }).catch((error) => {
    dbPromise = null // 다음에 다시 시도할 수 있게 합니다.
    throw error
  })
  return dbPromise
}

/** 트랜잭션을 실행하고 완료될 때까지 기다립니다. */
async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb()
  return new Promise<T | undefined>((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(stores, mode)
    } catch (error) {
      reject(toStorageError(error))
      return
    }
    let request: IDBRequest<T> | void
    try {
      request = work(tx)
    } catch (error) {
      // 작업을 준비하다 실패하면(예: 저장 공간 부족) 트랜잭션을 취소해 일부만 저장되지 않게 합니다.
      try {
        tx.abort()
      } catch {
        // 이미 끝난 트랜잭션이면 무시합니다.
      }
      reject(toStorageError(error))
      return
    }
    tx.oncomplete = () => resolve(request ? request.result : undefined)
    tx.onerror = () => reject(toStorageError(tx.error))
    tx.onabort = () => reject(toStorageError(tx.error))
  })
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 저장된 요소 하나를 검사합니다. 잘못된 요소는 null */
export function parseBoardItem(value: unknown): BoardItem | null {
  if (!isRecord(value)) return null
  const { id, type, x, y, w, h } = value
  if (typeof id !== 'string' || ![x, y, w, h].every(isNum)) return null
  const base = { id, x: x as number, y: y as number, w: Math.max(1, w as number), h: Math.max(1, h as number) }
  switch (type) {
    case 'image':
      return typeof value.imageId === 'string' ? { ...base, type, imageId: value.imageId } : null
    case 'color': {
      const hex = typeof value.hex === 'string' ? normalizeHex(value.hex) : null
      return hex ? { ...base, type, hex } : null
    }
    case 'note':
      return typeof value.text === 'string' ? { ...base, type, text: value.text } : null
    case 'palette': {
      if (!Array.isArray(value.colors)) return null
      const colors = value.colors.map((c) => (typeof c === 'string' ? normalizeHex(c) : null))
      if (colors.length === 0 || colors.some((c) => c === null)) return null
      const name = typeof value.name === 'string' ? value.name : '팔레트'
      return { ...base, type, name, colors: colors as string[] }
    }
    default:
      return null
  }
}

/** 저장된 프로젝트를 검사합니다. 잘못된 요소는 빼고, 프로젝트 자체가 잘못되면 null */
export function parseProject(value: unknown): MoodboardProject | null {
  if (!isRecord(value)) return null
  const { id, name, items, createdAt, updatedAt } = value
  if (typeof id !== 'string' || typeof name !== 'string') return null
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null
  const parsed = Array.isArray(items) ? items.map(parseBoardItem).filter((i): i is BoardItem => i !== null) : []
  return { id, name, items: parsed, createdAt, updatedAt }
}

export async function listProjects(): Promise<MoodboardProject[]> {
  try {
    const all = await run<unknown[]>([PROJECTS], 'readonly', (tx) => tx.objectStore(PROJECTS).getAll())
    return (all ?? [])
      .map(parseProject)
      .filter((p): p is MoodboardProject => p !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch (error) {
    throw toStorageError(error)
  }
}

export async function saveProject(project: MoodboardProject): Promise<void> {
  await run([PROJECTS], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).put(project)
  })
}

/** 프로젝트와 그 프로젝트의 이미지를 한 번에 지웁니다. */
export async function deleteProject(projectId: string): Promise<void> {
  await run([PROJECTS, IMAGES], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).delete(projectId)
    const images = tx.objectStore(IMAGES)
    const keys = images.index('projectId').getAllKeys(projectId)
    keys.onsuccess = () => {
      for (const key of keys.result) images.delete(key)
    }
  })
}

export async function saveImage(image: StoredImage): Promise<void> {
  await run([IMAGES], 'readwrite', (tx) => {
    tx.objectStore(IMAGES).put(image)
  })
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return run<StoredImage>([IMAGES], 'readonly', (tx) => tx.objectStore(IMAGES).get(id))
}

export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await run([IMAGES], 'readwrite', (tx) => {
    const store = tx.objectStore(IMAGES)
    for (const id of ids) store.delete(id)
  })
}

/**
 * 어떤 프로젝트에서도 쓰지 않는 이미지를 지우고, 지운 개수를 돌려줍니다.
 * (이미지를 저장한 직후 프로젝트 저장 전에 앱이 닫히면 이런 이미지가 남을 수 있습니다)
 * 이미지 데이터(Blob)는 읽지 않고 id만 훑어 보기 때문에 메모리를 거의 쓰지 않습니다.
 */
export async function pruneOrphanImages(projects: MoodboardProject[]): Promise<number> {
  const used = new Set(projects.flatMap((p) => p.items.flatMap((i) => (i.type === 'image' ? [i.imageId] : []))))
  let removed = 0
  await run([IMAGES], 'readwrite', (tx) => {
    const store = tx.objectStore(IMAGES)
    const cursor = store.index('projectId').openKeyCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      const id = c.primaryKey as string
      if (!used.has(id)) {
        store.delete(id)
        removed++
      }
      c.continue()
    }
  })
  return removed
}

/** 브라우저가 알려 주는 저장 공간 사용량 (지원하지 않으면 null) */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null
    return { usage: estimate.usage, quota: estimate.quota }
  } catch {
    return null
  }
}
