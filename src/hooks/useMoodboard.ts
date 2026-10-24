// 무드보드 프로젝트 목록, 현재 프로젝트의 요소, 이미지 주소를 관리하는 훅입니다.
// 화면 컴포넌트(Moodboard.tsx)는 이 훅이 돌려주는 값과 함수만 사용합니다.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardItem, MoodboardProject } from '../types'
import { ImageError, loadImage } from '../utils/extractColors'
import { downloadBlob, toFileName } from '../utils/exportPalette'
import { renderMoodboardPng } from '../utils/exportMoodboard'
import { createId } from '../utils/id'
import {
  deleteImages,
  deleteProject as dbDeleteProject,
  getImage,
  listProjects,
  pruneOrphanImages,
  saveImage,
  saveProject,
  StorageError,
} from '../utils/moodboardDb'
import { prepareImage } from '../utils/moodboardImage'

/** 무드보드 캔버스의 크기 (px) */
export const BOARD_WIDTH = 1600
export const BOARD_HEIGHT = 1000
/** 프로젝트 하나에 넣을 수 있는 참고 이미지 수 (저장 공간 보호) */
export const MAX_IMAGES_PER_PROJECT = 40
const SAVE_DELAY_MS = 400
const CURRENT_KEY = 'palette-studio:current-project'
const DEFAULT_NAME = '새 무드보드'

export type ReorderAction = 'front' | 'forward' | 'backward' | 'back'

const now = () => new Date().toISOString()
const message = (error: unknown, fallback: string) =>
  error instanceof StorageError || error instanceof ImageError ? error.message : fallback

/** 요소가 보드 밖으로 나가지 않게 하고, 위치·크기를 정수 픽셀로 맞춥니다. */
const clampItem = <T extends BoardItem>(item: T): T => {
  const w = Math.round(Math.min(BOARD_WIDTH, Math.max(24, item.w)))
  const h = Math.round(Math.min(BOARD_HEIGHT, Math.max(24, item.h)))
  return {
    ...item,
    w,
    h,
    x: Math.round(Math.min(BOARD_WIDTH - w, Math.max(0, item.x))),
    y: Math.round(Math.min(BOARD_HEIGHT - h, Math.max(0, item.y))),
  }
}

function newProject(name: string): MoodboardProject {
  const time = now()
  return { id: createId('project'), name, items: [], createdAt: time, updatedAt: time }
}

/**
 * 처음 한 번만 프로젝트 목록을 읽습니다. 하나도 없으면 기본 프로젝트를 만듭니다.
 * (개발 모드의 StrictMode는 effect를 두 번 실행하므로, 기본 프로젝트가 두 번 만들어지지 않도록 공유합니다)
 */
let initialLoad: Promise<MoodboardProject[]> | null = null
function loadInitialProjects() {
  initialLoad ??= (async () => {
    const list = await listProjects()
    // 시작할 때 연결이 끊긴 이미지를 정리합니다. 실패해도 앱 사용에는 지장이 없습니다.
    await pruneOrphanImages(list).catch(() => 0)
    if (list.length > 0) return list
    const first = newProject('내 첫 무드보드')
    await saveProject(first)
    return [first]
  })().catch((error) => {
    initialLoad = null
    throw error
  })
  return initialLoad
}

function readCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

/** 새 요소를 놓을 위치: 요소가 늘어날수록 조금씩 비켜서 겹치지 않게 합니다. */
function nextPosition(items: BoardItem[]) {
  const offset = (items.length % 10) * 24
  return { x: 60 + offset, y: 60 + offset }
}

export function useMoodboard(notify: (message: string) => void) {
  const [projects, setProjects] = useState<MoodboardProject[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  /** 이미지 id → 화면에 표시할 임시 주소(Object URL) */
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  const current = projects.find((p) => p.id === currentId) ?? null

  // ── 저장 예약: 끌어서 옮기는 동안 매번 저장하지 않고, 멈춘 뒤 한 번만 저장합니다 ──
  const pending = useRef(new Map<string, MoodboardProject>())
  const saveTimer = useRef<number | undefined>(undefined)

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    const list = [...pending.current.values()]
    pending.current.clear()
    for (const project of list) {
      try {
        await saveProject(project)
      } catch (e) {
        setError(message(e, '무드보드를 저장하지 못했습니다.'))
      }
    }
  }, [])

  const scheduleSave = useCallback(
    (project: MoodboardProject) => {
      pending.current.set(project.id, project)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  // 처음 열 때 프로젝트 목록 읽기
  useEffect(() => {
    let cancelled = false
    loadInitialProjects()
      .then((list) => {
        if (cancelled) return
        const saved = readCurrentId()
        setProjects(list)
        setCurrentId(list.some((p) => p.id === saved) ? saved : list[0].id)
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(message(e, '무드보드를 불러오지 못했습니다.'))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 페이지를 닫거나 컴포넌트가 사라질 때 저장되지 않은 변경을 저장
  useEffect(() => {
    const handle = () => void flush()
    window.addEventListener('pagehide', handle)
    return () => {
      window.removeEventListener('pagehide', handle)
      void flush()
    }
  }, [flush])

  // 마지막으로 연 프로젝트 기억 (작은 값이라 LocalStorage 사용)
  useEffect(() => {
    if (!currentId) return
    try {
      localStorage.setItem(CURRENT_KEY, currentId)
    } catch {
      // 기억하지 못해도 동작에는 문제가 없습니다.
    }
  }, [currentId])

  // ── 이미지 주소 관리: 현재 프로젝트에 필요한 이미지만 IndexedDB에서 꺼내 표시합니다 ──
  const urlMap = useRef(new Map<string, string>())
  const imageIdsKey = (current?.items ?? [])
    .flatMap((i) => (i.type === 'image' ? [i.imageId] : []))
    .sort()
    .join('|')

  useEffect(() => {
    const needed = new Set(imageIdsKey ? imageIdsKey.split('|') : [])
    // 더 이상 쓰지 않는 주소는 해제해 메모리를 돌려줍니다.
    for (const [id, url] of urlMap.current) {
      if (!needed.has(id)) {
        URL.revokeObjectURL(url)
        urlMap.current.delete(id)
      }
    }
    let cancelled = false
    const missing = [...needed].filter((id) => !urlMap.current.has(id))
    Promise.all(
      missing.map(async (id) => {
        const stored = await getImage(id)
        if (stored && !cancelled && !urlMap.current.has(id)) {
          urlMap.current.set(id, URL.createObjectURL(stored.blob))
        }
      }),
    )
      .catch(() => setError('일부 이미지를 불러오지 못했습니다.'))
      .finally(() => {
        if (!cancelled) setImageUrls(Object.fromEntries(urlMap.current))
      })
    return () => {
      cancelled = true
    }
  }, [imageIdsKey])

  // 훅이 사라질 때 모든 이미지 주소 해제
  useEffect(() => {
    const map = urlMap.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      map.clear()
    }
  }, [])

  // ── 현재 프로젝트 수정 공통 함수 ──
  const updateProject = useCallback(
    (change: (project: MoodboardProject) => MoodboardProject) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== currentId) return p
          const next = { ...change(p), updatedAt: now() }
          scheduleSave(next)
          return next
        }),
      )
    },
    [currentId, scheduleSave],
  )

  const updateItems = useCallback(
    (change: (items: BoardItem[]) => BoardItem[]) => updateProject((p) => ({ ...p, items: change(p.items) })),
    [updateProject],
  )

  const addItem = useCallback(
    (item: BoardItem) => {
      updateItems((items) => [...items, clampItem(item)])
      setSelectedItemId(item.id)
    },
    [updateItems],
  )

  // ── 프로젝트 관리 ──
  const createProject = async (name = DEFAULT_NAME) => {
    await flush()
    const project = newProject(name.trim() || DEFAULT_NAME)
    try {
      await saveProject(project)
      setProjects((prev) => [...prev, project])
      setCurrentId(project.id)
      setSelectedItemId(null)
      setError(null)
      notify(`'${project.name}' 프로젝트를 만들었습니다.`)
    } catch (e) {
      setError(message(e, '프로젝트를 만들지 못했습니다.'))
    }
  }

  const renameProject = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateProject((p) => ({ ...p, name: trimmed.slice(0, 60) }))
  }

  const selectProject = async (id: string) => {
    await flush()
    setCurrentId(id)
    setSelectedItemId(null)
  }

  const deleteProject = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    pending.current.delete(id)
    try {
      await flush()
      await dbDeleteProject(id)
      let remaining = projects.filter((p) => p.id !== id)
      // 프로젝트가 하나도 없으면 빈 프로젝트를 새로 만들어 둡니다.
      if (remaining.length === 0) {
        const fresh = newProject(DEFAULT_NAME)
        await saveProject(fresh)
        remaining = [fresh]
      }
      setProjects(remaining)
      if (id === currentId) setCurrentId(remaining[0].id)
      setSelectedItemId(null)
      notify(`'${target?.name ?? '프로젝트'}' 삭제됨`)
    } catch (e) {
      setError(message(e, '프로젝트를 삭제하지 못했습니다.'))
    }
  }

  // ── 요소 추가 ──
  const addImages = async (files: File[], at?: { x: number; y: number }) => {
    if (!current || files.length === 0) return
    const projectId = current.id
    const imageCount = current.items.filter((i) => i.type === 'image').length
    const room = MAX_IMAGES_PER_PROJECT - imageCount
    if (room <= 0) {
      setError(`프로젝트당 이미지는 최대 ${MAX_IMAGES_PER_PROJECT}개까지 넣을 수 있습니다.`)
      return
    }
    setBusy(true)
    setError(null)
    const failures: string[] = []
    const added: BoardItem[] = []
    for (const file of files.slice(0, room)) {
      try {
        const prepared = await prepareImage(file)
        const imageId = createId('image')
        await saveImage({ id: imageId, projectId, ...prepared, createdAt: now() })
        const w = 320
        const h = Math.max(40, Math.round((prepared.height / prepared.width) * w))
        const base = at
          ? { x: at.x - w / 2 + added.length * 24, y: at.y - h / 2 + added.length * 24 }
          : nextPosition([...current.items, ...added])
        added.push(clampItem({ id: createId('item'), type: 'image', imageId, w, h, ...base }))
      } catch (e) {
        failures.push(`${file.name}: ${message(e, '이미지를 추가하지 못했습니다.')}`)
      }
    }
    if (files.length > room) failures.push(`이미지 수 제한으로 ${files.length - room}개는 추가하지 않았습니다.`)
    // 이미지를 처리하는 동안 다른 프로젝트로 바꿨다면, 원래 프로젝트에 넣습니다.
    if (added.length > 0) {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p
          const next = { ...p, items: [...p.items, ...added], updatedAt: now() }
          scheduleSave(next)
          return next
        }),
      )
      setSelectedItemId(added[added.length - 1].id)
      notify(`이미지 ${added.length}개를 추가했습니다.`)
    }
    if (failures.length > 0) setError(failures.join('\n'))
    setBusy(false)
  }

  const addPalette = (name: string, colors: string[]) => {
    if (!current || colors.length === 0) return
    const w = Math.min(560, Math.max(240, colors.length * 64))
    addItem({ id: createId('item'), type: 'palette', name, colors, w, h: 140, ...nextPosition(current.items) })
  }

  const addColor = (hex: string, at?: { x: number; y: number }) => {
    if (!current) return
    const size = 120
    const pos = at ? { x: at.x - size / 2, y: at.y - size / 2 } : nextPosition(current.items)
    addItem({ id: createId('item'), type: 'color', hex, w: size, h: size, ...pos })
  }

  const addNote = () => {
    if (!current) return
    addItem({ id: createId('item'), type: 'note', text: '', w: 220, h: 140, ...nextPosition(current.items) })
  }

  // ── 요소 수정 · 삭제 · 순서 ──
  const updateItem = useCallback(
    (id: string, patch: Partial<BoardItem>) => {
      updateItems((items) =>
        items.map((item) => (item.id === id ? clampItem({ ...item, ...patch } as BoardItem) : item)),
      )
    },
    [updateItems],
  )

  const removeItem = useCallback(
    (id: string) => {
      const item = current?.items.find((i) => i.id === id)
      if (!item) return
      updateItems((items) => items.filter((i) => i.id !== id))
      setSelectedItemId(null)
      // 다른 요소가 같은 이미지를 쓰지 않으면 저장된 이미지도 지웁니다.
      if (item.type === 'image') {
        const stillUsed = current?.items.some((i) => i.id !== id && i.type === 'image' && i.imageId === item.imageId)
        if (!stillUsed) {
          deleteImages([item.imageId]).catch(() => setError('이미지 데이터를 지우지 못했습니다.'))
        }
      }
    },
    [current, updateItems],
  )

  const clearBoard = () => {
    if (!current) return
    const imageIds = current.items.flatMap((i) => (i.type === 'image' ? [i.imageId] : []))
    updateItems(() => [])
    setSelectedItemId(null)
    deleteImages(imageIds).catch(() => setError('이미지 데이터를 지우지 못했습니다.'))
  }

  /** 겹침 순서 변경: 배열 뒤쪽에 있을수록 위에 그려집니다. */
  const reorderItem = (id: string, action: ReorderAction) => {
    updateItems((items) => {
      const from = items.findIndex((i) => i.id === id)
      if (from < 0) return items
      const to =
        action === 'front' ? items.length - 1
        : action === 'back' ? 0
        : action === 'forward' ? Math.min(items.length - 1, from + 1)
        : Math.max(0, from - 1)
      if (to === from) return items
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // ── PNG 내보내기 ──
  const exportPng = async () => {
    if (!current || current.items.length === 0) return
    setBusy(true)
    try {
      const images = new Map<string, HTMLImageElement>()
      await Promise.all(
        Object.entries(imageUrls).map(async ([id, url]) => {
          try {
            images.set(id, await loadImage(url))
          } catch {
            // 불러오지 못한 이미지는 회색 상자로 그립니다.
          }
        }),
      )
      const blob = await renderMoodboardPng(current.items, images)
      downloadBlob(blob, `${toFileName(current.name)}-moodboard.png`)
    } catch {
      setError('무드보드 PNG를 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return {
    status,
    error,
    clearError: () => setError(null),
    busy,
    projects,
    current,
    imageUrls,
    selectedItemId,
    setSelectedItemId,
    createProject,
    renameProject,
    selectProject,
    deleteProject,
    addImages,
    addPalette,
    addColor,
    addNote,
    updateItem,
    removeItem,
    clearBoard,
    reorderItem,
    exportPng,
  }
}

export type MoodboardState = ReturnType<typeof useMoodboard>
