import { useState } from 'react'
import type { PaletteColor } from '../types'
import {
  contrastRatio,
  hasInvalidHexChars,
  hexToHsl,
  hexToRgb,
  hslToHex,
  normalizeHex,
  readableTextColor,
  rgbToHex,
  validateHexInput,
  wcagGrade,
  type HSL,
  type RGB,
} from '../utils/color'

interface ColorEditorProps {
  color: PaletteColor | null
  /** 선택한 색이 팔레트에서 몇 번째인지 (0부터 시작) */
  index: number
  total: number
  onChange: (hex: string) => void
  onCopy: (hex: string) => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onAddToBoard: () => void
}

/** 입력 중인 HEX 값을 검사해 문제가 있으면 안내 문구를 돌려줍니다. */
/**
 * 오른쪽 색상 편집 패널.
 * App에서 key={color.id}를 주기 때문에, 다른 색을 고르면 이 컴포넌트가 새로 만들어져
 * 입력 상태가 그 색 기준으로 초기화됩니다.
 */
export function ColorEditor(props: ColorEditorProps) {
  const { color } = props
  if (!color) {
    return (
      <section className="panel-section">
        <div className="section-title">
          <h2>색상 편집</h2>
        </div>
        <p className="empty-hint">팔레트에서 색을 선택하면 여기서 편집할 수 있습니다.</p>
      </section>
    )
  }

  return <EditorBody {...props} color={color} />
}

function EditorBody({
  color,
  index,
  total,
  onChange,
  onCopy,
  onDelete,
  onMove,
  onAddToBoard,
}: ColorEditorProps & { color: PaletteColor }) {
  const hex = color.hex
  const rgb = hexToRgb(hex)
  // HEX 입력칸은 타이핑 도중 잘못된 값이 있을 수 있어서 따로 상태로 관리합니다.
  const [hexDraft, setHexDraft] = useState(hex)
  // Enter나 포커스 이동으로 확정하려 했을 때만 "미완성" 오류를 보여 줍니다.
  const [showHexError, setShowHexError] = useState(false)
  // HSL은 회색(채도 0)일 때 색상(H) 값이 사라지므로, 슬라이더 값을 따로 기억합니다.
  const [hsl, setHsl] = useState<HSL>(() => hexToHsl(hex))

  const hexError = validateHexInput(hexDraft)
  // 허용되지 않는 문자는 입력하는 즉시 알려 줍니다.
  const visibleHexError = hexError && (showHexError || hasInvalidHexChars(hexDraft)) ? hexError : null

  const apply = (nextHex: string, nextHsl?: HSL) => {
    setHexDraft(nextHex)
    setShowHexError(false)
    setHsl(nextHsl ?? hexToHsl(nextHex))
    onChange(nextHex)
  }

  const handleHexInput = (value: string) => {
    setHexDraft(value)
    setShowHexError(false)
    // 6자리가 완성되면 바로 반영해 팔레트·미리보기가 즉시 바뀌도록 합니다.
    if (/^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
      const normalized = normalizeHex(value)!
      setHsl(hexToHsl(normalized))
      onChange(normalized)
    }
  }

  const commitHexDraft = () => {
    const normalized = normalizeHex(hexDraft)
    if (normalized) apply(normalized)
    else setShowHexError(true)
  }

  const updateRgb = (key: keyof RGB, value: number) =>
    apply(rgbToHex({ ...rgb, [key]: value }))

  const updateHsl = (key: keyof HSL, value: number) => {
    const next = { ...hsl, [key]: value }
    apply(hslToHex(next), next)
  }

  const onWhite = contrastRatio(hex, '#FFFFFF')
  const onBlack = contrastRatio(hex, '#000000')

  return (
    <>
      <section className="panel-section">
        <div className="section-title">
          <h2>색상 편집</h2>
        </div>

        <div
          className="editor-preview"
          style={{ background: hex, color: readableTextColor(hex) }}
        >
          <code>{hex}</code>
          <input
            type="color"
            value={hex.toLowerCase()}
            aria-label="색상 선택기"
            title="색상 선택기 열기"
            onChange={(e) => apply(e.target.value.toUpperCase())}
          />
        </div>

        <div className="hex-input-row">
          <label className="field">
            <span>HEX</span>
            <input
              type="text"
              value={hexDraft}
              spellCheck={false}
              maxLength={7}
              aria-invalid={visibleHexError !== null}
              aria-describedby="hex-error"
              onChange={(e) => handleHexInput(e.target.value)}
              onBlur={commitHexDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitHexDraft()
                // Esc를 누르면 현재 색상 값으로 되돌립니다.
                if (e.key === 'Escape') {
                  setHexDraft(hex)
                  setShowHexError(false)
                }
              }}
            />
          </label>
          <button type="button" className="btn" onClick={() => onCopy(hex)}>
            복사
          </button>
        </div>
        <p id="hex-error" className="field-error" role="alert">
          {visibleHexError}
        </p>

        <div className="order-row">
          <span>
            순서 <strong>{index + 1}</strong> / {total}
          </span>
          <div className="button-row-tight">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onMove(-1)}
              disabled={index <= 0}
              aria-label="앞으로 이동"
            >
              ↑ 앞으로
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onMove(1)}
              disabled={index >= total - 1}
              aria-label="뒤로 이동"
            >
              ↓ 뒤로
            </button>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <h3 className="sub-title">RGB</h3>
        {(['r', 'g', 'b'] as const).map((key) => (
          <SliderRow
            key={key}
            label={key.toUpperCase()}
            min={0}
            max={255}
            value={rgb[key]}
            track={`linear-gradient(to right, ${rgbToHex({ ...rgb, [key]: 0 })}, ${rgbToHex({ ...rgb, [key]: 255 })})`}
            onChange={(v) => updateRgb(key, v)}
          />
        ))}

        <h3 className="sub-title">HSL</h3>
        <SliderRow
          label="H"
          min={0}
          max={360}
          value={hsl.h}
          track={`linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
            .map((h) => hslToHex({ ...hsl, h, s: Math.max(hsl.s, 60), l: 50 }))
            .join(', ')})`}
          onChange={(v) => updateHsl('h', v)}
        />
        <SliderRow
          label="S"
          min={0}
          max={100}
          value={hsl.s}
          track={`linear-gradient(to right, ${hslToHex({ ...hsl, s: 0 })}, ${hslToHex({ ...hsl, s: 100 })})`}
          onChange={(v) => updateHsl('s', v)}
        />
        <SliderRow
          label="L"
          min={0}
          max={100}
          value={hsl.l}
          track={`linear-gradient(to right, #000, ${hslToHex({ ...hsl, l: 50 })}, #fff)`}
          onChange={(v) => updateHsl('l', v)}
        />
      </section>

      <section className="panel-section">
        <h3 className="sub-title">글자 대비 (WCAG)</h3>
        <ContrastRow label="흰 글자" fg="#FFFFFF" bg={hex} ratio={onWhite} />
        <ContrastRow label="검은 글자" fg="#000000" bg={hex} ratio={onBlack} />
      </section>

      <section className="panel-section editor-actions">
        <button type="button" className="btn btn-primary" onClick={onAddToBoard}>
          무드보드에 추가
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          팔레트에서 삭제
        </button>
      </section>
    </>
  )
}

interface SliderRowProps {
  label: string
  min: number
  max: number
  value: number
  track: string
  onChange: (value: number) => void
}

function SliderRow({ label, min, max, value, track, onChange }: SliderRowProps) {
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        className="color-range"
        min={min}
        max={max}
        value={value}
        style={{ background: track }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="slider-number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </label>
  )
}

function ContrastRow({
  label,
  fg,
  bg,
  ratio,
}: {
  label: string
  fg: string
  bg: string
  ratio: number
}) {
  const grade = wcagGrade(ratio)
  return (
    <div className="contrast-row">
      <span className="contrast-sample" style={{ background: bg, color: fg }}>
        Aa
      </span>
      <span>{label}</span>
      <span className="contrast-ratio">{ratio.toFixed(2)} : 1</span>
      <span className={`badge${ratio < 3 ? ' badge-fail' : ''}`}>{grade}</span>
    </div>
  )
}
