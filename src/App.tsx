import { useCallback, useRef, useState } from 'react'
import './App.css'
import { ColorEditor } from './components/ColorEditor'
import { ImageUploader } from './components/ImageUploader'
import { HarmonyPanel } from './components/HarmonyPanel'
import { Moodboard } from './components/Moodboard'
import { PalettePanel } from './components/PalettePanel'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { useMoodboard } from './hooks/useMoodboard'
import type { PaletteColor } from './types'
import { copyText } from './utils/clipboard'
import { extractPalette, ImageError, loadImage, validateImageFile } from './utils/extractColors'
import { createId } from './utils/id'
import { PaletteLibrary } from './components/PaletteLibrary'
import { downloadBlob, downloadJson, renderPalettePng, toFileName } from './utils/exportPalette'
import {
  createPalette,
  loadPalettes,
  MAX_COLORS,
  PaletteDataError,
  palettesToJson,
  parseImportedJson,
  savePalettes,
  type SavedPalette,
} from './utils/paletteStorage'

const UNTITLED = '이름 없는 팔레트'
const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** 오류 객체를 사용자에게 보여 줄 문장으로 바꿉니다. */
const toMessage = (error: unknown, fallback: string) =>
  error instanceof ImageError ? error.message : fallback

function App() {
  // ── 이미지 & 팔레트 상태 ───────────────────────────
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [imageSize, setImageSize] = useState('')
  const [colorCount, setColorCount] = useState(6)
  const [isExtracting, setIsExtracting] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [colors, setColors] = useState<PaletteColor[]>([])
  /** 다시 추출할 때 이미지를 새로 읽지 않도록 로드된 이미지를 보관합니다. */
  const imageRef = useRef<HTMLImageElement | null>(null)
  /** 추출 요청 번호: 개수를 빠르게 바꿀 때 늦게 끝난 이전 결과를 무시하기 위함 */
  const extractRequest = useRef(0)

  // ── 팔레트 저장 상태 ───────────────────────────────
  // 처음 한 번만 LocalStorage에서 저장된 팔레트를 읽습니다.
  const [initialLoad] = useState(loadPalettes)
  const [savedPalettes, setSavedPalettes] = useState<SavedPalette[]>(initialLoad.palettes)
  /**
   * 가장 최근에 저장한 목록. 화면 상태(savedPalettes)는 다음 렌더링 때 바뀌므로,
   * 저장을 연달아 할 때 이전 목록을 덮어쓰지 않도록 항상 이 값을 기준으로 계산합니다.
   */
  const savedRef = useRef<SavedPalette[]>(initialLoad.palettes)
  const [libraryError, setLibraryError] = useState<string | null>(initialLoad.error)
  const [paletteName, setPaletteName] = useState('새 팔레트')
  /** 지금 편집 중인 팔레트가 저장된 팔레트라면 그 id */
  const [currentPaletteId, setCurrentPaletteId] = useState<string | null>(null)
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null)

  // ── 가운데 작업 영역 ───────────────────────────────
  const [tab, setTab] = useState<'board' | 'harmony'>('board')
  /** 색상 추출에 쓴 원본 파일 (무드보드에 "추출 이미지 넣기"용) */
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)

  // ── 알림 메시지 ───────────────────────────────────
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }, [])

  // 무드보드 프로젝트·이미지는 IndexedDB에 저장됩니다. (자세한 내용은 hooks/useMoodboard.ts)
  const board = useMoodboard(showToast)

  const selectedColor = colors.find((c) => c.id === selectedColorId) ?? null

  /** 이미지에서 색을 추출해 팔레트를 새로 채웁니다. */
  const runExtraction = async (img: HTMLImageElement, count: number) => {
    const requestId = ++extractRequest.current
    setIsExtracting(true)
    setUploadError(null)
    try {
      // "분석 중" 표시가 화면에 먼저 그려지도록 한 프레임 양보합니다.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const extracted = extractPalette(img, count).map(({ hex, ratio }) => ({
        id: createId('color'),
        hex,
        ratio,
      }))
      if (requestId !== extractRequest.current) return
      setColors(extracted)
      setSelectedColorId(extracted[0]?.id ?? null)
      if (extracted.length < count) {
        showToast(`색 구성이 단순해 서로 다른 색 ${extracted.length}개만 추출했습니다.`)
      }
    } catch (error) {
      if (requestId !== extractRequest.current) return
      setUploadError(toMessage(error, '색상 추출 중 문제가 발생했습니다. 다른 이미지로 시도해 주세요.'))
    } finally {
      if (requestId === extractRequest.current) setIsExtracting(false)
    }
  }

  const handleFile = async (file: File) => {
    const invalid = validateImageFile(file)
    if (invalid) {
      setUploadError(invalid)
      return
    }
    // 파일을 서버에 올리지 않고, 브라우저 메모리 안의 임시 주소로만 사용합니다.
    const url = URL.createObjectURL(file)
    let img: HTMLImageElement
    try {
      img = await loadImage(url)
    } catch (error) {
      URL.revokeObjectURL(url)
      setUploadError(toMessage(error, '이미지를 불러오지 못했습니다.'))
      return
    }
    // 이전 미리보기 주소는 해제합니다. (무드보드 이미지는 IndexedDB에 따로 저장되므로 영향 없음)
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    imageRef.current = img
    setUploadedFile(file)
    setImageSrc(url)
    setImageName(file.name)
    // 새 이미지는 새 팔레트로 시작합니다. 이름은 파일 이름에서 확장자를 뺀 값입니다.
    setPaletteName(file.name.replace(/\.[^.]+$/, '') || UNTITLED)
    setCurrentPaletteId(null)
    setImageSize(`${img.naturalWidth}×${img.naturalHeight}`)
    await runExtraction(img, colorCount)
  }

  const handleCountChange = (count: number) => {
    setColorCount(count)
    if (imageRef.current) void runExtraction(imageRef.current, count)
  }

  const handleReextract = () => {
    if (imageRef.current) void runExtraction(imageRef.current, colorCount)
  }

  const handleCopy = async (hex: string) => {
    const ok = await copyText(hex)
    showToast(ok ? `${hex} 복사됨` : '복사에 실패했습니다.')
  }

  const handleCopyAll = async () => {
    const text = colors.map((c) => c.hex).join(', ')
    const ok = await copyText(text)
    showToast(ok ? `${colors.length}개 색상 복사됨` : '복사에 실패했습니다.')
  }

  // ── 팔레트 편집 ───────────────────────────────────
  const updateSelectedColor = (hex: string) => {
    setColors((prev) =>
      prev.map((c) => (c.id === selectedColorId ? { ...c, hex } : c)),
    )
  }

  const moveSelectedColor = (direction: -1 | 1) => {
    setColors((prev) => {
      const from = prev.findIndex((c) => c.id === selectedColorId)
      const to = from + direction
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }

  // ── 팔레트 저장 · 불러오기 · 내보내기 ─────────────────
  /** 목록을 저장소에 쓰고, 성공했을 때만 화면 상태를 바꿉니다. */
  const persist = (change: (list: SavedPalette[]) => SavedPalette[]) => {
    const next = change(savedRef.current)
    const error = savePalettes(next)
    setLibraryError(error)
    if (!error) {
      savedRef.current = next
      setSavedPalettes(next)
    }
    return error === null
  }

  /** 지금 화면의 팔레트를 저장 형식으로 바꿉니다. base가 있으면 그 팔레트를 수정합니다. */
  const toSavedPalette = (base?: SavedPalette): SavedPalette => {
    const name = paletteName.trim() || UNTITLED
    const hexes = colors.map((c) => c.hex)
    const ratios = colors.map((c) => c.ratio)
    if (base) return { ...base, name, colors: hexes, ratios, updatedAt: new Date().toISOString() }
    return createPalette(name, hexes, ratios)
  }

  const savePalette = (asNew: boolean) => {
    if (colors.length === 0) return
    const existing = asNew ? undefined : savedRef.current.find((p) => p.id === currentPaletteId)
    const palette = toSavedPalette(existing)
    const saved = persist((list) =>
      existing ? list.map((p) => (p.id === palette.id ? palette : p)) : [palette, ...list],
    )
    if (saved) {
      setCurrentPaletteId(palette.id)
      setPaletteName(palette.name)
      showToast(existing ? '변경 사항을 저장했습니다.' : `'${palette.name}' 저장됨`)
    }
  }

  const loadSavedPalette = (id: string) => {
    const palette = savedRef.current.find((p) => p.id === id)
    if (!palette) return
    // 진행 중인 색상 추출이 있으면 결과를 버리도록 요청 번호를 올립니다.
    extractRequest.current++
    setIsExtracting(false)
    const loaded = palette.colors.map((hex, i) => ({
      id: createId('color'),
      hex,
      ratio: palette.ratios[i],
    }))
    setColors(loaded)
    setSelectedColorId(loaded[0]?.id ?? null)
    setPaletteName(palette.name)
    setCurrentPaletteId(palette.id)
    setLibraryError(null)
    showToast(`'${palette.name}' 불러옴`)
  }

  const deleteSavedPalette = (id: string) => {
    const target = savedPalettes.find((p) => p.id === id)
    if (persist((list) => list.filter((p) => p.id !== id))) {
      if (id === currentPaletteId) setCurrentPaletteId(null)
      showToast(`'${target?.name ?? '팔레트'}' 삭제됨`)
    }
  }

  const exportCurrentJson = () => {
    const palette = toSavedPalette(savedPalettes.find((p) => p.id === currentPaletteId))
    downloadJson(palettesToJson([palette]), `${toFileName(palette.name)}.json`)
  }

  const exportAllJson = () => {
    downloadJson(palettesToJson(savedPalettes), 'palette-studio-palettes.json')
  }

  const exportPng = async () => {
    const name = paletteName.trim() || UNTITLED
    try {
      const blob = await renderPalettePng(name, colors)
      downloadBlob(blob, `${toFileName(name)}.png`)
    } catch {
      setLibraryError('PNG 이미지를 만들지 못했습니다.')
    }
  }

  const importJson = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setLibraryError('2MB 이하의 JSON 파일만 가져올 수 있습니다.')
      return
    }
    try {
      const imported = parseImportedJson(await file.text())
      // 이미 있는 id와 겹치면 새 id를 붙여, 기존 팔레트를 덮어쓰지 않습니다.
      const ids = new Set(savedRef.current.map((p) => p.id))
      const fresh = imported.map((p) => {
        const palette = ids.has(p.id) ? { ...p, id: createId('palette') } : p
        ids.add(palette.id)
        return palette
      })
      if (persist((list) => [...fresh, ...list])) {
        showToast(`팔레트 ${fresh.length}개를 가져왔습니다.`)
      }
    } catch (error) {
      setLibraryError(error instanceof PaletteDataError ? error.message : '파일을 읽지 못했습니다.')
    }
  }

  const addColor = () => {
    if (colors.length >= MAX_COLORS) {
      showToast(`색은 최대 ${MAX_COLORS}개까지 추가할 수 있습니다.`)
      return
    }
    const base = selectedColor?.hex ?? '#4D7CFE'
    const newColor: PaletteColor = { id: createId('color'), hex: base, ratio: 0 }
    setColors((prev) => [...prev, newColor])
    setSelectedColorId(newColor.id)
  }

  const deleteSelectedColor = () => {
    const index = colors.findIndex((c) => c.id === selectedColorId)
    if (index < 0) return
    const next = colors.filter((c) => c.id !== selectedColorId)
    setColors(next)
    // 삭제 후에는 바로 옆 색을 선택해 둡니다.
    setSelectedColorId(next[Math.min(index, next.length - 1)]?.id ?? null)
  }

  /** 배색 추천 결과를 새 팔레트로 저장합니다. (비율 정보가 없으므로 0) */
  const saveHarmonyPalette = (name: string, hexes: string[]) => {
    const palette = createPalette(name, hexes, hexes.map(() => 0))
    if (persist((list) => [palette, ...list])) {
      showToast(`'${name}' 저장됨 · 왼쪽 저장 목록에서 불러올 수 있습니다`)
    }
  }

  return (
    <div className="app">
      <TopBar colorCount={colors.length} onCopyAll={handleCopyAll} />

      <div className="app-body">
        {/* 왼쪽 패널: 이미지 업로드 + 팔레트 */}
        <aside className="sidebar sidebar-left">
          <ImageUploader
            imageSrc={imageSrc}
            imageName={imageName}
            imageSize={imageSize}
            colorCount={colorCount}
            isExtracting={isExtracting}
            error={uploadError}
            onFile={handleFile}
            onCountChange={handleCountChange}
            onReextract={handleReextract}
          />
          <PalettePanel
            colors={colors}
            selectedId={selectedColorId}
            onSelect={setSelectedColorId}
            onCopy={handleCopy}
            onAdd={addColor}
          />
          <PaletteLibrary
            name={paletteName}
            currentId={currentPaletteId}
            hasColors={colors.length > 0}
            palettes={savedPalettes}
            error={libraryError}
            onNameChange={setPaletteName}
            onSave={() => savePalette(false)}
            onSaveAsNew={() => savePalette(true)}
            onLoad={loadSavedPalette}
            onDelete={deleteSavedPalette}
            onExportJson={exportCurrentJson}
            onExportAllJson={exportAllJson}
            onExportPng={exportPng}
            onImportFile={importJson}
          />
        </aside>

        {/* 가운데: 무드보드 / 배색 분석 탭 */}
        <main className="main">
          <div className="main-tabs" role="tablist" aria-label="작업 영역">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'board'}
              className={tab === 'board' ? 'is-active' : ''}
              onClick={() => setTab('board')}
            >
              무드보드
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'harmony'}
              className={tab === 'harmony' ? 'is-active' : ''}
              onClick={() => setTab('harmony')}
            >
              배색 분석
            </button>
          </div>
          {tab === 'board' ? (
            <Moodboard
              board={board}
              savedPalettes={savedPalettes}
              currentPalette={{ name: paletteName.trim() || UNTITLED, colors: colors.map((c) => c.hex) }}
              uploadedFile={uploadedFile}
            />
          ) : (
            <HarmonyPanel
              baseColor={selectedColor}
              colors={colors}
              onCopy={handleCopy}
              onSavePalette={saveHarmonyPalette}
            />
          )}
        </main>

        {/* 오른쪽 패널: 선택한 색 편집 */}
        <aside className="sidebar sidebar-right">
          <ColorEditor
            key={selectedColor?.id ?? 'none'}
            color={selectedColor}
            index={colors.findIndex((c) => c.id === selectedColorId)}
            total={colors.length}
            onChange={updateSelectedColor}
            onCopy={handleCopy}
            onDelete={deleteSelectedColor}
            onMove={moveSelectedColor}
            onAddToBoard={() => {
              if (!selectedColor) return
              board.addColor(selectedColor.hex)
              setTab('board')
            }}
          />
        </aside>
      </div>

      <Toast message={toast} />
    </div>
  )
}

export default App
