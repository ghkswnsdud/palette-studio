import { useMemo } from 'react'
import type { PaletteColor } from '../types'
import { contrastRatio, hexToHsl, readableTextColor, wcagGrade } from '../utils/color'
import {
  buildHarmonies,
  hexToOklch,
  isAchromatic,
  MAX_SRGB_CHROMA,
  oklchToHex,
  type HarmonyResult,
} from '../utils/harmony'

/** 대비표에 표시할 최대 색 수 (너무 많으면 표가 읽기 어려워집니다) */
const MAX_MATRIX_COLORS = 8

interface HarmonyPanelProps {
  baseColor: PaletteColor | null
  colors: PaletteColor[]
  onCopy: (text: string) => void
  onSavePalette: (name: string, hexes: string[]) => void
}

/** 배색 분석 화면: 배색 추천, 명도·채도 비교, WCAG 대비표 */
export function HarmonyPanel({ baseColor, colors, onCopy, onSavePalette }: HarmonyPanelProps) {
  const harmonies = useMemo(
    () => (baseColor ? buildHarmonies(baseColor.hex) : []),
    [baseColor],
  )

  if (!baseColor) {
    return (
      <div className="analysis">
        <p className="empty-hint analysis-empty">
          이미지를 올리거나 팔레트에서 색을 선택하면 배색 분석이 표시됩니다.
        </p>
      </div>
    )
  }

  const base = hexToOklch(baseColor.hex)

  return (
    <div className="analysis">
      {/* ── 기준 색 ── */}
      <section className="analysis-card analysis-base">
        <span
          className="analysis-base-chip"
          style={{ background: baseColor.hex, color: readableTextColor(baseColor.hex) }}
        >
          기준
        </span>
        <div>
          <h3>{baseColor.hex}</h3>
          <p className="analysis-muted">
            OKLCH 밝기 {(base.l * 100).toFixed(1)}% · 채도 {base.c.toFixed(3)} · 색상각 {base.h.toFixed(1)}°
          </p>
          <p className="analysis-muted">
            오른쪽 패널이나 왼쪽 팔레트에서 다른 색을 고르면 기준 색이 바뀝니다.
          </p>
        </div>
      </section>

      {isAchromatic(baseColor.hex) && (
        <p className="analysis-notice" role="status">
          기준 색이 회색 계열(무채색)이라 색상 각도가 거의 의미가 없습니다. 추천 색도 비슷한 회색으로
          나오니, 채도가 있는 색을 기준으로 골라 보세요.
        </p>
      )}

      {/* ── 배색 추천 ── */}
      <h2 className="analysis-heading">배색 추천</h2>
      <div className="harmony-grid">
        {harmonies.map((h) => (
          <HarmonyCard
            key={h.kind}
            harmony={h}
            onCopy={onCopy}
            onSave={() =>
              onSavePalette(
                `${baseColor.hex} ${h.label}`,
                h.colors.map((c) => c.hex),
              )
            }
          />
        ))}
      </div>

      {/* ── 명도 · 채도 비교 ── */}
      <h2 className="analysis-heading">명도 · 채도 비교</h2>
      <section className="analysis-card">
        <p className="analysis-muted">
          명도는 사람 눈 기준의 밝기(OKLCH L), 채도는 선명도(OKLCH C)를 화면에서 표현할 수 있는 최대값
          대비 비율로 보여 줍니다. 괄호 안은 익숙한 HSL 값입니다.
        </p>
        {colors.length === 0 ? (
          <p className="empty-hint">팔레트에 색이 없습니다.</p>
        ) : (
          <div className="compare-table" role="table" aria-label="명도와 채도 비교">
            <div className="compare-row compare-head" role="row">
              <span role="columnheader">색</span>
              <span role="columnheader">명도</span>
              <span role="columnheader">채도</span>
            </div>
            {colors.map((c) => {
              const ok = hexToOklch(c.hex)
              const hsl = hexToHsl(c.hex)
              const chromaPct = Math.min(100, (ok.c / MAX_SRGB_CHROMA) * 100)
              return (
                <div
                  key={c.id}
                  className={`compare-row${c.id === baseColor.id ? ' is-base' : ''}`}
                  role="row"
                >
                  <span className="compare-color" role="cell">
                    <i style={{ background: c.hex }} />
                    <code>{c.hex}</code>
                  </span>
                  <Bar value={ok.l * 100} label={`${(ok.l * 100).toFixed(0)} (L ${hsl.l}%)`} />
                  <Bar
                    value={chromaPct}
                    color={oklchToHex({ l: 0.65, c: ok.c, h: ok.h })}
                    label={`${chromaPct.toFixed(0)} (S ${hsl.s}%)`}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── WCAG 대비 ── */}
      <h2 className="analysis-heading">텍스트 가독성 (WCAG 대비율)</h2>
      <section className="analysis-card">
        <p className="analysis-muted">
          행은 글자색, 열은 배경색입니다. <b>AAA</b> 7:1 이상 · <b>AA</b> 4.5:1 이상(본문) ·{' '}
          <b>AA 큰 글자</b> 3:1 이상(18pt 또는 굵은 14pt 이상). 참고용이며 실제 화면에서도 확인하세요.
        </p>
        <ContrastMatrix colors={colors} />
      </section>
    </div>
  )
}

function HarmonyCard({
  harmony,
  onCopy,
  onSave,
}: {
  harmony: HarmonyResult
  onCopy: (text: string) => void
  onSave: () => void
}) {
  return (
    <article className="analysis-card harmony-card">
      <div className="harmony-head">
        <HueWheel hues={harmony.colors.map((c) => ({ hue: c.hue, hex: c.hex, isBase: c.offset === 0 }))} />
        <div>
          <h3>{harmony.label}</h3>
          <p className="analysis-muted">{harmony.description}</p>
        </div>
      </div>
      <div className="harmony-swatches">
        {harmony.colors.map((c, i) => (
          <button
            key={i}
            type="button"
            className="harmony-swatch"
            style={{ background: c.hex, color: readableTextColor(c.hex) }}
            title="클릭해서 HEX 복사"
            onClick={() => onCopy(c.hex)}
          >
            <code>{c.hex}</code>
            <small>
              {c.offset === 0 ? '기준' : `${c.offset > 0 ? '+' : ''}${c.offset}°`} · {c.hue.toFixed(0)}°
            </small>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-small" onClick={onSave}>
        새 팔레트로 저장
      </button>
    </article>
  )
}

/** 색상환 위에 추천 색의 각도를 점으로 표시하는 작은 그림 */
function HueWheel({ hues }: { hues: { hue: number; hex: string; isBase: boolean }[] }) {
  const size = 64
  const r = 24
  const center = size / 2
  // OKLCH 색상환 테두리 (30°마다 색을 계산)
  const ring = Array.from({ length: 12 }, (_, i) => {
    const start = (i * 30 - 90) * (Math.PI / 180)
    const end = ((i + 1) * 30 - 90) * (Math.PI / 180)
    const p = (a: number) => `${center + r * Math.cos(a)} ${center + r * Math.sin(a)}`
    return (
      <path
        key={i}
        d={`M ${p(start)} A ${r} ${r} 0 0 1 ${p(end)}`}
        stroke={oklchToHex({ l: 0.72, c: 0.13, h: i * 30 + 15 })}
        strokeWidth="6"
        fill="none"
      />
    )
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hue-wheel" aria-hidden="true">
      {ring}
      {hues.map((h, i) => {
        // 0°를 위쪽(12시)에 두고 시계 방향으로 각도를 표시합니다.
        const a = (h.hue - 90) * (Math.PI / 180)
        const x = center + r * Math.cos(a)
        const y = center + r * Math.sin(a)
        return (
          <g key={i}>
            <line x1={center} y1={center} x2={x} y2={y} stroke="currentColor" strokeOpacity="0.35" />
            <circle cx={x} cy={y} r={h.isBase ? 6 : 5} fill={h.hex} stroke="#fff" strokeWidth="2" />
          </g>
        )
      })}
    </svg>
  )
}

function Bar({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <span className="compare-bar" role="cell">
      <span className="compare-track">
        <i style={{ width: `${Math.max(1, Math.min(100, value))}%`, background: color }} />
      </span>
      <small>{label}</small>
    </span>
  )
}

function ContrastMatrix({ colors }: { colors: PaletteColor[] }) {
  // 흰색·검정도 함께 비교해 글자색 선택에 참고할 수 있게 합니다.
  const list = [
    ...colors.slice(0, MAX_MATRIX_COLORS).map((c) => c.hex),
    '#FFFFFF',
    '#000000',
  ].filter((hex, i, arr) => arr.indexOf(hex) === i)

  return (
    <>
      {colors.length > MAX_MATRIX_COLORS && (
        <p className="analysis-muted">팔레트 앞쪽 {MAX_MATRIX_COLORS}개 색만 표시합니다.</p>
      )}
      <div className="matrix-scroll">
        <table className="contrast-matrix">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">글자색 \ 배경색</span>
              </th>
              {list.map((bg) => (
                <th key={bg} scope="col">
                  <i style={{ background: bg }} title={bg} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((fg) => (
              <tr key={fg}>
                <th scope="row">
                  <i style={{ background: fg }} title={fg} />
                </th>
                {list.map((bg) => {
                  if (fg === bg) return <td key={bg} className="matrix-self">—</td>
                  const ratio = contrastRatio(fg, bg)
                  const grade = wcagGrade(ratio)
                  return (
                    <td key={bg} style={{ background: bg, color: fg }} title={`${fg} 글자 / ${bg} 배경`}>
                      <strong>Aa</strong>
                      <small>{ratio.toFixed(1)}</small>
                      <em className={`matrix-grade grade-${grade === '부족' ? 'fail' : grade === 'AA 큰 글자' ? 'large' : 'pass'}`}>
                        {grade}
                      </em>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
