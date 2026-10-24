import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, type MoodboardState } from '../hooks/useMoodboard'
import type { BoardItem } from '../types'
import { readableTextColor } from '../utils/color'
import { ACCEPT_ATTR } from '../utils/extractColors'
import type { SavedPalette } from '../utils/paletteStorage'
import { DRAG_COLOR_TYPE } from './PalettePanel'

const MIN_SIZE = 48

interface MoodboardProps {
  board: MoodboardState
  savedPalettes: SavedPalette[]
  currentPalette: { name: string; colors: string[] }
  /** 왼쪽에서 색상 추출용으로 올린 이미지 파일 */
  uploadedFile: File | null
}

/** 드래그(이동/크기 조절) 중인 상태를 기억하기 위한 정보 */
interface DragState {
  id: string
  mode: 'move' | 'resize'
  startX: number
  startY: number
  origin: { x: number; y: number; w: number; h: number }
}

export function Moodboard({ board, savedPalettes, currentPalette, uploadedFile }: MoodboardProps) {
  const { current, selectedItemId, setSelectedItemId, updateItem, removeItem } = board
  const boardRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // 되돌릴 수 없는 작업은 한 번 더 눌러야 실행됩니다.
  const [confirm, setConfirm] = useState<'project' | 'clear' | null>(null)
  const items = current?.items ?? []
  const selected = items.find((i) => i.id === selectedItemId) ?? null

  // Delete / Backspace 키로 선택한 요소 삭제 (입력칸에서 타이핑 중일 때는 제외)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selectedItemId) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeItem(selectedItemId)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedItemId, removeItem])

  const startDrag = (e: PointerEvent<HTMLElement>, item: BoardItem, mode: DragState['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelectedItemId(item.id)
    dragRef.current = {
      id: item.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: item.x, y: item.y, w: item.w, h: item.h },
    }
    // 포인터가 요소 밖으로 나가도 계속 움직임을 받기 위해 캡처합니다.
    // 브라우저가 캡처를 거부해도(이미 끝난 포인터 등) 끌기는 계속 동작하므로 오류만 무시합니다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 캡처 없이 진행합니다.
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const { x, y, w, h } = drag.origin
    if (drag.mode === 'move') {
      updateItem(drag.id, { x: x + dx, y: y + dy })
    } else {
      updateItem(drag.id, {
        w: Math.min(BOARD_WIDTH - x, Math.max(MIN_SIZE, w + dx)),
        h: Math.min(BOARD_HEIGHT - y, Math.max(MIN_SIZE, h + dy)),
      })
    }
  }

  const endDrag = () => {
    dragRef.current = null
  }

  /** 화면 좌표 → 보드 안 좌표 */
  const toBoardPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  // 팔레트의 색, 또는 컴퓨터의 이미지 파일을 끌어다 놓기
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!boardRef.current) return
    const hex = e.dataTransfer.getData(DRAG_COLOR_TYPE)
    const point = toBoardPoint(e.clientX, e.clientY)
    if (hex) {
      e.preventDefault()
      board.addColor(hex, point)
    } else if (e.dataTransfer.files.length > 0) {
      e.preventDefault()
      void board.addImages([...e.dataTransfer.files], point)
    }
  }

  const commitRename = () => {
    if (renaming !== null) board.renameProject(renaming)
    setRenaming(null)
  }

  const disabled = board.status !== 'ready' || !current

  return (
    <section className="workspace">
      {/* ── 1줄: 프로젝트 관리 ── */}
      <div className="workspace-toolbar">
        <div className="toolbar-group">
          {renaming !== null ? (
            <input
              className="project-name-input"
              value={renaming}
              maxLength={60}
              autoFocus
              aria-label="프로젝트 이름"
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <select
              className="project-select"
              aria-label="프로젝트 선택"
              value={current?.id ?? ''}
              disabled={disabled}
              onChange={(e) => void board.selectProject(e.target.value)}
            >
              {board.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.items.length})
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-small" disabled={disabled} onClick={() => void board.createProject()}>
            새 프로젝트
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={disabled}
            onClick={() => setRenaming(current?.name ?? '')}
          >
            이름 변경
          </button>
          {confirm === 'project' ? (
            <button
              type="button"
              className="btn btn-small btn-danger"
              autoFocus
              onBlur={() => setConfirm(null)}
              onClick={() => {
                setConfirm(null)
                if (current) void board.deleteProject(current.id)
              }}
            >
              이미지까지 삭제 확인
            </button>
          ) : (
            <button type="button" className="btn btn-small" disabled={disabled} onClick={() => setConfirm('project')}>
              프로젝트 삭제
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={disabled || items.length === 0 || board.busy}
          onClick={() => void board.exportPng()}
        >
          PNG 내보내기
        </button>
      </div>

      {/* ── 2줄: 요소 추가 · 배치 ── */}
      <div className="workspace-toolbar workspace-toolbar-sub">
        <div className="toolbar-group">
          <button type="button" className="btn btn-small" disabled={disabled || board.busy} onClick={() => fileRef.current?.click()}>
            참고 이미지 추가
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void board.addImages(files)
            }}
          />
          <button
            type="button"
            className="btn btn-small"
            disabled={disabled || board.busy || !uploadedFile}
            title="왼쪽에서 색상 추출에 사용한 이미지를 넣습니다"
            onClick={() => uploadedFile && void board.addImages([uploadedFile])}
          >
            추출 이미지 넣기
          </button>
          <select
            className="btn btn-small palette-select"
            aria-label="팔레트 넣기"
            value=""
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value
              if (value === '__current') board.addPalette(currentPalette.name, currentPalette.colors)
              else {
                const p = savedPalettes.find((s) => s.id === value)
                if (p) board.addPalette(p.name, p.colors)
              }
            }}
          >
            <option value="" disabled>
              팔레트 넣기…
            </option>
            {currentPalette.colors.length > 0 && <option value="__current">현재 편집 중: {currentPalette.name}</option>}
            {savedPalettes.length > 0 && (
              <optgroup label="저장된 팔레트">
                {savedPalettes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.colors.length}색)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn btn-small" disabled={disabled} onClick={board.addNote}>
            메모 추가
          </button>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">배치</span>
          {(
            [
              ['front', '맨 앞'],
              ['forward', '앞으로'],
              ['backward', '뒤로'],
              ['back', '맨 뒤'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              className="btn btn-small"
              disabled={!selected}
              onClick={() => selected && board.reorderItem(selected.id, action)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="btn btn-small" disabled={!selected} onClick={() => selected && removeItem(selected.id)}>
            선택 삭제
          </button>
          {confirm === 'clear' ? (
            <button
              type="button"
              className="btn btn-small btn-danger"
              autoFocus
              onBlur={() => setConfirm(null)}
              onClick={() => {
                setConfirm(null)
                board.clearBoard()
              }}
            >
              모두 지우기 확인
            </button>
          ) : (
            <button type="button" className="btn btn-small" disabled={items.length === 0} onClick={() => setConfirm('clear')}>
              모두 지우기
            </button>
          )}
        </div>
      </div>

      {board.error && (
        <div className="board-error" role="alert">
          <p>{board.error}</p>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={board.clearError}>
            ✕
          </button>
        </div>
      )}

      <div className="workspace-scroll">
        <div
          ref={boardRef}
          className="board"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
          onPointerDown={() => setSelectedItemId(null)}
          onDragOver={(e) => {
            const types = e.dataTransfer.types
            if (types.includes(DRAG_COLOR_TYPE) || types.includes('Files')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={handleDrop}
        >
          {board.status === 'loading' && <div className="board-empty">무드보드를 불러오는 중…</div>}
          {board.busy && <div className="board-busy">처리 중…</div>}
          {board.status === 'ready' && items.length === 0 && (
            <div className="board-empty">
              <p>
                팔레트의 색이나 컴퓨터의 이미지를 이곳으로 <strong>끌어다 놓거나</strong>, 위 도구 막대로
                참고 이미지·팔레트·메모를 추가해 보세요. 작업 내용은 이 브라우저에 자동 저장됩니다.
              </p>
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className={`board-item board-item-${item.type}${item.id === selectedItemId ? ' is-selected' : ''}`}
              style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
              onPointerDown={(e) => {
                // 메모는 위쪽 손잡이로만 이동하고, 본문은 글쓰기에 사용합니다.
                if (item.type === 'note') {
                  e.stopPropagation()
                  setSelectedItemId(item.id)
                  return
                }
                startDrag(e, item, 'move')
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <BoardItemView item={item} imageUrl={item.type === 'image' ? board.imageUrls[item.imageId] : undefined} />

              {item.type === 'note' && (
                <>
                  <div className="note-handle" onPointerDown={(e) => startDrag(e, item, 'move')} title="끌어서 이동" />
                  <textarea
                    value={item.text}
                    placeholder="메모를 입력하세요"
                    maxLength={2000}
                    onChange={(e) => updateItem(item.id, { text: e.target.value })}
                  />
                </>
              )}

              <div
                className="resize-handle"
                title="끌어서 크기 조절"
                onPointerDown={(e) => startDrag(e, item, 'resize')}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** 메모를 제외한 요소의 내용 표시 */
function BoardItemView({ item, imageUrl }: { item: BoardItem; imageUrl?: string }) {
  switch (item.type) {
    case 'image':
      return imageUrl ? (
        <img src={imageUrl} alt="" draggable={false} />
      ) : (
        <div className="board-image-missing">이미지 불러오는 중…</div>
      )
    case 'color':
      return (
        <div className="board-color" style={{ background: item.hex, color: readableTextColor(item.hex) }}>
          <code>{item.hex}</code>
        </div>
      )
    case 'palette':
      return (
        <div className="board-palette">
          <strong>{item.name}</strong>
          <div className="board-palette-swatches">
            {item.colors.map((hex, i) => (
              <span key={i} style={{ background: hex, color: readableTextColor(hex) }}>
                <code>{hex}</code>
              </span>
            ))}
          </div>
        </div>
      )
    case 'note':
      return null
  }
}
