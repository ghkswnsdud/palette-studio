import type { PaletteColor } from '../types'
import { hexToRgb, readableTextColor } from '../utils/color'

/** '#4D7CFE' → 'rgb(77, 124, 254)' */
const toRgbText = (hex: string) => {
  const { r, g, b } = hexToRgb(hex)
  return `rgb(${r}, ${g}, ${b})`
}

/** 팔레트 색을 무드보드로 끌어다 놓을 때 쓰는 데이터 형식 이름 */
export const DRAG_COLOR_TYPE = 'application/x-palette-hex'

interface PalettePanelProps {
  colors: PaletteColor[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCopy: (hex: string) => void
  onAdd: () => void
}

/** 추출된 주요 색상을 보여 주는 팔레트 목록 */
export function PalettePanel({
  colors,
  selectedId,
  onSelect,
  onCopy,
  onAdd,
}: PalettePanelProps) {
  return (
    <section className="panel-section">
      <div className="section-title">
        <h2>팔레트</h2>
        <button type="button" className="btn btn-link" onClick={onAdd}>
          + 색 추가
        </button>
      </div>

      {colors.length === 0 ? (
        <p className="empty-hint">
          이미지를 올리면 주요 색상이 여기에 자동으로 표시됩니다.
        </p>
      ) : (
        <>
          {/* 색상 비율을 한눈에 보여 주는 막대 */}
          <div className="palette-strip" aria-hidden="true">
            {colors.map((c) => (
              <span
                key={c.id}
                style={{ background: c.hex, flexGrow: Math.max(c.ratio, 0.04) }}
              />
            ))}
          </div>

          <ul className="swatch-list">
            {colors.map((c) => (
              <li key={c.id}>
                <div
                  className={`swatch-row${c.id === selectedId ? ' is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  draggable
                  title="클릭해서 편집 · 무드보드로 끌어다 놓기"
                  onClick={() => onSelect(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect(c.id)
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_COLOR_TYPE, c.hex)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <span
                    className="swatch-chip"
                    style={{ background: c.hex, color: readableTextColor(c.hex) }}
                  />
                  <span className="swatch-info">
                    {/* 코드를 클릭하면 바로 복사됩니다. 행 선택이 같이 일어나지 않게 전파를 막습니다. */}
                    {[c.hex, toRgbText(c.hex)].map((code) => (
                      <button
                        key={code}
                        type="button"
                        className="code-copy"
                        title="클릭해서 복사"
                        aria-label={`${code} 복사`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onCopy(code)
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {code}
                      </button>
                    ))}
                  </span>
                  <span className="swatch-ratio" title="이미지 내 픽셀 비율">
                    {c.ratio > 0 ? (
                      <>
                        <span>{(c.ratio * 100).toFixed(1)}%</span>
                        <i style={{ width: `${Math.max(c.ratio * 100, 2)}%` }} />
                      </>
                    ) : (
                      <span>직접 추가</span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
