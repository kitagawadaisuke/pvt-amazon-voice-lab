export interface ScrapeResult {
  url: string
  contentHash: string
  contentText: string
  scrapedAt: Date
}

export interface DiffResult {
  url: string
  changes: Array<{
    type: 'added' | 'removed' | 'modified'
    selector: string
    oldValue?: string
    newValue?: string
  }>
  hasSignificantChanges: boolean
}

// Mock scraper for development (replace with Playwright/ScrapingBee later)
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const mockContent = `Mock content for ${url} at ${new Date().toISOString()}`
  const encoder = new TextEncoder()
  const data = encoder.encode(mockContent)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  return { url, contentHash, contentText: mockContent, scrapedAt: new Date() }
}

export function detectChanges(before: string, after: string, url: string): DiffResult {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const changes: DiffResult['changes'] = []

  const maxLen = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < maxLen; i++) {
    if (i >= beforeLines.length) {
      changes.push({ type: 'added', selector: `line-${i}`, newValue: afterLines[i] })
    } else if (i >= afterLines.length) {
      changes.push({ type: 'removed', selector: `line-${i}`, oldValue: beforeLines[i] })
    } else if (beforeLines[i] !== afterLines[i]) {
      changes.push({ type: 'modified', selector: `line-${i}`, oldValue: beforeLines[i], newValue: afterLines[i] })
    }
  }

  return { url, changes, hasSignificantChanges: changes.length > 0 }
}

// Mock data for demo
export function generateMockChanges(url: string): DiffResult {
  return {
    url,
    changes: [
      {
        type: 'modified',
        selector: 'h1.hero-title',
        oldValue: '最高のサービスを提供',
        newValue: '業界No.1のサービス',
      },
      {
        type: 'modified',
        selector: '.pricing .price',
        oldValue: '月額 9,800円',
        newValue: '月額 12,800円（税込）',
      },
      {
        type: 'added',
        selector: '.new-banner',
        newValue: '新機能リリース: AIアシスタント搭載',
      },
    ],
    hasSignificantChanges: true,
  }
}
