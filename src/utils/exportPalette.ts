// 팔레트를 파일(JSON, PNG)로 내려받는 기능입니다. 모두 브라우저 안에서 만들어집니다.

import { hexToRgb, readableTextColor } from './color'

/** 파일 이름에 쓸 수 없는 문자를 바꿉니다. */
export function toFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'palette'
  )
}

/** Blob(파일 데이터)을 사용자 컴퓨터로 내려받게 합니다. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 다운로드가 시작될 시간을 준 뒤 임시 주소를 해제합니다.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadJson(json: string, fileName: string) {
  downloadBlob(new Blob([json], { type: 'application/json' }), fileName)
}

interface PngColor {
  hex: string
  ratio: number
}

/** 팔레트를 PNG 이미지로 그려서 Blob으로 돌려줍니다. */
export function renderPalettePng(name: string, colors: PngColor[]): Promise<Blob> {
  const width = 1200
  const padding = 48
  const titleHeight = 72
  const swatchHeight = 360
  const labelHeight = 96
  const height = padding * 2 + titleHeight + swatchHeight + labelHeight
  // 고해상도 화면에서도 선명하도록 2배 크기로 그립니다.
  const scale = 2

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas를 사용할 수 없습니다.'))
  ctx.scale(scale, scale)

  const font = "system-ui, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
  const mono = "ui-monospace, Consolas, monospace"

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#16161D'
  ctx.font = `600 28px ${font}`
  ctx.textBaseline = 'top'
  ctx.fillText(name, padding, padding, width - padding * 2)

  const innerWidth = width - padding * 2
  const columnWidth = innerWidth / colors.length
  const top = padding + titleHeight

  colors.forEach((c, i) => {
    const x = padding + i * columnWidth
    ctx.fillStyle = c.hex
    ctx.fillRect(x, top, Math.ceil(columnWidth), swatchHeight)

    // 색 위에 HEX 코드 (배경에 맞춰 흰색/검정 글자)
    ctx.fillStyle = readableTextColor(c.hex)
    ctx.font = `600 ${colors.length > 8 ? 14 : 18}px ${mono}`
    ctx.fillText(c.hex, x + 14, top + swatchHeight - 34, columnWidth - 20)

    // 아래쪽에 RGB와 비율
    const { r, g, b } = hexToRgb(c.hex)
    ctx.fillStyle = '#4A4A57'
    ctx.font = `${colors.length > 8 ? 12 : 14}px ${mono}`
    ctx.fillText(`${r}, ${g}, ${b}`, x + 4, top + swatchHeight + 18, columnWidth - 8)
    if (c.ratio > 0) {
      ctx.fillStyle = '#8A8A98'
      ctx.fillText(`${(c.ratio * 100).toFixed(1)}%`, x + 4, top + swatchHeight + 42, columnWidth - 8)
    }
  })

  ctx.fillStyle = '#B0B0BC'
  ctx.font = `12px ${font}`
  ctx.textAlign = 'right'
  ctx.fillText('Palette Studio', width - padding, height - padding + 12)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0
      canvas.height = 0
      if (blob) resolve(blob)
      else reject(new Error('PNG를 만들지 못했습니다.'))
    }, 'image/png')
  })
}
