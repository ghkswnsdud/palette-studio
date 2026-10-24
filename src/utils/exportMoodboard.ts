// 무드보드를 PNG 이미지로 그립니다. 화면의 요소를 Canvas에 같은 위치로 다시 그리는 방식입니다.

import type { BoardItem } from '../types'
import { readableTextColor } from './color'

const PADDING = 40
/** Canvas 한 변의 최대 크기. 너무 크면 브라우저가 이미지를 만들지 못합니다. */
const MAX_CANVAS_SIDE = 8000
const FONT = "system-ui, 'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
const MONO = 'ui-monospace, Consolas, monospace'

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** 이미지를 상자에 꽉 차게(넘치는 부분은 잘라서) 그립니다. CSS object-fit: cover와 같습니다. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.naturalWidth - sw) / 2
  const sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/** 상자 너비에 맞춰 글자를 여러 줄로 나눕니다. (줄바꿈 문자도 반영) */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    // 한글은 띄어쓰기 없이 길게 쓰는 경우가 많아 글자 단위로 나눕니다.
    for (const ch of paragraph) {
      const next = line + ch
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = ch.trimStart()
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem, images: Map<string, HTMLImageElement>) {
  const { x, y, w, h } = item
  ctx.save()
  roundedRect(ctx, x, y, w, h, 8)
  ctx.clip()

  switch (item.type) {
    case 'image': {
      const img = images.get(item.imageId)
      if (img) drawCover(ctx, img, x, y, w, h)
      else {
        ctx.fillStyle = '#DDDDE3'
        ctx.fillRect(x, y, w, h)
      }
      break
    }
    case 'color':
      ctx.fillStyle = item.hex
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = readableTextColor(item.hex)
      ctx.font = `600 12px ${MONO}`
      ctx.textBaseline = 'bottom'
      ctx.fillText(item.hex, x + 8, y + h - 8, w - 16)
      break
    case 'palette': {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#16161D'
      ctx.font = `600 13px ${FONT}`
      ctx.textBaseline = 'top'
      ctx.fillText(item.name, x + 10, y + 9, w - 20)
      const top = y + 32
      const swatchH = h - 32
      const sw = w / item.colors.length
      item.colors.forEach((hex, i) => {
        ctx.fillStyle = hex
        ctx.fillRect(x + i * sw, top, Math.ceil(sw), swatchH)
        if (sw >= 56) {
          ctx.fillStyle = readableTextColor(hex)
          ctx.font = `600 10px ${MONO}`
          ctx.textBaseline = 'bottom'
          ctx.fillText(hex, x + i * sw + 6, y + h - 6, sw - 10)
        }
      })
      break
    }
    case 'note': {
      ctx.fillStyle = '#FFF8C5'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#3D3A1F'
      ctx.font = `13px ${FONT}`
      ctx.textBaseline = 'top'
      const lineHeight = 19
      wrapText(ctx, item.text, w - 20).forEach((line, i) => {
        ctx.fillText(line, x + 10, y + 24 + i * lineHeight)
      })
      break
    }
  }
  ctx.restore()

  // 요소 테두리 (화면과 비슷하게)
  ctx.save()
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
  ctx.stroke()
  ctx.restore()
}

/**
 * 무드보드 요소들을 PNG로 그립니다. 요소가 있는 영역만 잘라서 내보냅니다.
 * images: 이미지 id → 로드된 이미지 요소
 */
export function renderMoodboardPng(items: BoardItem[], images: Map<string, HTMLImageElement>): Promise<Blob> {
  if (items.length === 0) return Promise.reject(new Error('내보낼 요소가 없습니다.'))

  const minX = Math.min(...items.map((i) => i.x)) - PADDING
  const minY = Math.min(...items.map((i) => i.y)) - PADDING
  const maxX = Math.max(...items.map((i) => i.x + i.w)) + PADDING
  const maxY = Math.max(...items.map((i) => i.y + i.h)) + PADDING
  const width = maxX - minX
  const height = maxY - minY
  const scale = Math.min(2, MAX_CANVAS_SIDE / Math.max(width, height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas를 사용할 수 없습니다.'))

  ctx.scale(scale, scale)
  ctx.translate(-minX, -minY)
  ctx.fillStyle = '#F4F4F6'
  ctx.fillRect(minX, minY, width, height)
  for (const item of items) drawItem(ctx, item, images)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0
      canvas.height = 0
      if (blob) resolve(blob)
      else reject(new Error('PNG를 만들지 못했습니다.'))
    }, 'image/png')
  })
}
