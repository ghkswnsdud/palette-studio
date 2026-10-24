// 이미지에서 대표 색상을 뽑아내는 로직입니다.
//
// 처리 순서:
// 1. 파일 검사: 형식(JPG/PNG/WebP)과 용량을 확인합니다.
// 2. 축소 분석: 이미지를 최대 200px 크기의 Canvas에 그려 픽셀을 읽습니다.
//    (원본 그대로 읽으면 수천만 개의 픽셀로 메모리를 많이 쓰기 때문입니다)
// 3. 후보 추출: quantize 라이브러리(MMCQ 알고리즘)로 원하는 개수보다 넉넉하게 후보 색을 뽑습니다.
// 4. 중복 제거: 많이 쓰인 색부터 고르되, 이미 고른 색과 너무 비슷한(ΔE가 작은) 색은 건너뜁니다.
// 5. 비율 계산: 모든 픽셀을 가장 가까운 최종 색에 배정해 색별 픽셀 비율을 구합니다.
// 모든 계산은 브라우저 안에서만 이루어지며, 이미지가 외부 서버로 전송되지 않습니다.

import quantize from 'quantize'
import { deltaE, rgbToHex, rgbToLab, type Lab, type RGB } from './color'

export interface ExtractedColor {
  hex: string
  rgb: RGB
  /** 이미지 안에서 이 색에 가장 가까운 픽셀의 비율 (0~1) */
  ratio: number
}

type Pixel = [number, number, number]

export const COLOR_COUNT_OPTIONS = [5, 6, 8, 10] as const
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const MAX_FILE_MB = 20
/** 원본 이미지의 최대 픽셀 수 (약 5000만 = 8K 사진 정도). 이보다 크면 메모리 보호를 위해 거부합니다. */
const MAX_SOURCE_PIXELS = 50_000_000
/** 분석용 축소 이미지의 최대 가로/세로 크기 (px). 최대 4만 픽셀만 분석합니다. */
const ANALYSIS_SIZE = 200
/** 비슷한 색 판정 기준(ΔE). 앞의 엄격한 기준으로 개수가 모자라면 점점 완화합니다. */
const MERGE_THRESHOLDS = [20, 14, 9, 5]

/** 사용자에게 그대로 보여 줄 수 있는 안내 문구를 담은 오류 */
export class ImageError extends Error {}

/** 올릴 수 없는 파일이면 안내 문구를, 괜찮으면 null을 돌려줍니다. */
export function validateImageFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  // 일부 환경에서는 file.type이 비어 있어서 확장자도 함께 확인합니다.
  const typeOk = file.type ? ACCEPTED_TYPES.includes(file.type) : ACCEPTED_EXTENSIONS.includes(ext)
  if (!typeOk) return 'JPG, JPEG, PNG, WebP 이미지 파일만 올릴 수 있습니다.'
  if (file.size === 0) return '비어 있는 파일입니다.'
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return `파일이 너무 큽니다. ${MAX_FILE_MB}MB 이하 이미지를 올려 주세요. (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB)`
  }
  return null
}

/** 이미지 주소(src)를 받아 실제로 로드된 <img> 요소를 돌려줍니다. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w === 0 || h === 0) {
        reject(new ImageError('이미지 크기를 읽을 수 없습니다.'))
      } else if (w * h > MAX_SOURCE_PIXELS) {
        reject(new ImageError(`이미지 해상도가 너무 큽니다. (${w}×${h}) 더 작은 이미지를 사용해 주세요.`))
      } else {
        resolve(img)
      }
    }
    img.onerror = () =>
      reject(new ImageError('이미지를 열 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.'))
    img.src = src
  })
}

/** 이미지를 작게 줄여 Canvas에 그린 뒤 불투명한 픽셀만 읽습니다. */
function readPixels(img: HTMLImageElement): Pixel[] {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ImageError('이 브라우저에서는 Canvas를 사용할 수 없습니다.')
  ctx.drawImage(img, 0, 0, width, height)

  const data = ctx.getImageData(0, 0, width, height).data
  const pixels: Pixel[] = []
  for (let i = 0; i < data.length; i += 4) {
    // 반투명·투명 픽셀은 배경이므로 제외합니다.
    if (data[i + 3] < 125) continue
    pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  // 분석이 끝난 캔버스는 크기를 0으로 만들어 메모리를 바로 돌려줍니다.
  canvas.width = 0
  canvas.height = 0
  return pixels
}

const toRgb = (p: Pixel): RGB => ({ r: p[0], g: p[1], b: p[2] })

/**
 * 각 픽셀을 Lab 거리 기준으로 가장 가까운 색에 배정하고,
 * 색별 픽셀 수와 배정된 픽셀들의 RGB 합계를 구합니다.
 */
function assignPixels(pixels: Pixel[], pixelLabs: Lab[], colors: Lab[]) {
  const counts = new Array<number>(colors.length).fill(0)
  const sums = colors.map((): Pixel => [0, 0, 0])
  for (let p = 0; p < pixelLabs.length; p++) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < colors.length; i++) {
      const d = deltaE(pixelLabs[p], colors[i])
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    counts[best]++
    sums[best][0] += pixels[p][0]
    sums[best][1] += pixels[p][1]
    sums[best][2] += pixels[p][2]
  }
  return { counts, sums }
}

/**
 * 픽셀 목록에서 서로 충분히 다른 대표 색을 최대 count개 고릅니다.
 * (Canvas와 무관한 순수 계산이라 따로 테스트할 수 있습니다)
 */
export function buildPalette(pixels: Pixel[], count: number): ExtractedColor[] {
  if (pixels.length === 0) return []

  // 같은 색 픽셀이 많으므로 Lab 변환 결과를 캐시해 계산량을 줄입니다.
  const labCache = new Map<number, Lab>()
  const pixelLabs = pixels.map((p) => {
    const key = (p[0] << 16) | (p[1] << 8) | p[2]
    let lab = labCache.get(key)
    if (!lab) {
      lab = rgbToLab(toRgb(p))
      labCache.set(key, lab)
    }
    return lab
  })

  // 1) MMCQ로 후보 색을 넉넉하게(요청 개수의 3배) 뽑습니다.
  const cmap = quantize(pixels, Math.min(256, Math.max(16, count * 3)))
  let candidates: Pixel[] = cmap ? cmap.palette() : []
  if (candidates.length === 0) {
    // 색이 하나뿐인 이미지 등에서는 quantize가 후보를 못 만들 수 있어 평균색을 씁니다.
    const sum = pixels.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
    candidates = [[sum[0] / pixels.length, sum[1] / pixels.length, sum[2] / pixels.length].map(Math.round) as Pixel]
  }
  const candidateLabs = candidates.map((c) => rgbToLab(toRgb(c)))

  // 2) 후보별 픽셀 수를 세고, 많이 쓰인 순서로 정렬합니다.
  const candidateCounts = assignPixels(pixels, pixelLabs, candidateLabs).counts
  const order = candidates
    .map((_, i) => i)
    .filter((i) => candidateCounts[i] > 0)
    .sort((a, b) => candidateCounts[b] - candidateCounts[a])

  // 3) 이미 고른 색과 ΔE가 기준 이상인 색만 채택해 비슷한 색 중복을 막습니다.
  const chosen: number[] = []
  for (const threshold of MERGE_THRESHOLDS) {
    for (const i of order) {
      if (chosen.length >= count) break
      if (chosen.includes(i)) continue
      if (chosen.every((j) => deltaE(candidateLabs[i], candidateLabs[j]) >= threshold)) {
        chosen.push(i)
      }
    }
    if (chosen.length >= count) break
  }

  // 4) 최종 색 기준으로 모든 픽셀을 다시 배정해, 비율의 합이 100%가 되도록 합니다.
  //    quantize는 색을 32단계로 묶어 계산해 값이 조금 어긋나므로,
  //    대표 색은 실제로 배정된 픽셀들의 평균으로 정합니다.
  const { counts, sums } = assignPixels(pixels, pixelLabs, chosen.map((i) => candidateLabs[i]))
  return chosen
    .map((_, k) => {
      const n = counts[k] || 1
      const rgb = toRgb([sums[k][0] / n, sums[k][1] / n, sums[k][2] / n].map(Math.round) as Pixel)
      return { hex: rgbToHex(rgb), rgb, ratio: counts[k] / pixels.length }
    })
    .filter((c) => c.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
}

/** 로드된 이미지에서 대표 색상을 최대 count개, 비율이 높은 순서로 돌려줍니다. */
export function extractPalette(img: HTMLImageElement, count: number): ExtractedColor[] {
  const pixels = readPixels(img)
  if (pixels.length === 0) {
    throw new ImageError('이미지가 모두 투명해서 색을 추출할 수 없습니다.')
  }
  return buildPalette(pixels, count)
}
