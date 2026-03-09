import { load } from 'cheerio'
import type { AnyNode } from 'domhandler'

// Amazon Review Scraper Service
// provider を切り替えて Amazon レビューを構造化データに正規化する

export interface AmazonReview {
  title: string
  body: string
  rating: number // 1-5
  date: string
  verified: boolean
  helpfulVotes: number
}

export type ReviewSource = 'rainforest' | 'scraperapi' | 'mock'

export interface ReviewCollection {
  asin: string
  productName: string
  totalReviews: number
  averageRating: number
  ratingBreakdown: { [key: number]: number }
  reviews: AmazonReview[]
  lowRatingReviews: AmazonReview[]
  highRatingReviews: AmazonReview[]
  fetchedAt: string
  fetchedCount: number
  source: ReviewSource
  warnings: string[]
}

class ReviewFetchError extends Error {
  provider: ReviewSource | 'unknown'

  constructor(message: string, provider: ReviewSource | 'unknown' = 'unknown') {
    super(message)
    this.name = 'ReviewFetchError'
    this.provider = provider
  }
}

type ReviewProvider = ReviewSource

interface ParsedReviewPage {
  productName?: string
  totalReviews?: number
  averageRating?: number
  reviews: AmazonReview[]
  hasNextPage: boolean
}

const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY
const REVIEW_PROVIDER = process.env.REVIEW_PROVIDER?.toLowerCase()
const REVIEW_MAX_PAGES = parsePositiveInt(process.env.REVIEW_MAX_PAGES, 10)
const REVIEW_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REVIEW_REQUEST_TIMEOUT_MS, 30000)
const REVIEW_REQUEST_RETRIES = parsePositiveInt(process.env.REVIEW_REQUEST_RETRIES, 3)
const REVIEW_REQUEST_DELAY_MS = parsePositiveInt(process.env.REVIEW_REQUEST_DELAY_MS, 1200)

/**
 * ASINからAmazonレビューを取得する
 */
export async function fetchReviews(asin: string): Promise<ReviewCollection> {
  const provider = resolveProvider()

  if (provider === 'mock') {
    return generateMockReviews(asin)
  }

  try {
    switch (provider) {
      case 'rainforest':
        return await fetchReviewsFromRainforest(asin)
      case 'scraperapi':
        return await fetchReviewsFromScraperApi(asin)
      default:
        throw new ReviewFetchError(`Unsupported review provider: ${provider}`, provider)
    }
  } catch (error) {
    console.error(`[review-scraper] ${provider} failed for ${asin}:`, error)
    throw normalizeReviewFetchError(error, provider)
  }
}

function resolveProvider(): ReviewProvider {
  if (REVIEW_PROVIDER === 'rainforest' || REVIEW_PROVIDER === 'scraperapi' || REVIEW_PROVIDER === 'mock') {
    return REVIEW_PROVIDER
  }

  if (SCRAPERAPI_KEY) return 'scraperapi'
  if (RAINFOREST_API_KEY) return 'rainforest'
  if (process.env.NODE_ENV !== 'production') return 'mock'

  throw new ReviewFetchError('No review provider configured. Set REVIEW_PROVIDER and provider credentials.', 'unknown')
}

async function fetchReviewsFromRainforest(asin: string): Promise<ReviewCollection> {
  if (!RAINFOREST_API_KEY) {
    throw new ReviewFetchError('RAINFOREST_API_KEY is not set', 'rainforest')
  }

  const url = `https://api.rainforestapi.com/request?api_key=${RAINFOREST_API_KEY}&type=product&asin=${asin}&amazon_domain=amazon.co.jp`
  const res = await fetchWithRetry(url, 'rainforest')
  const data = await res.json()

  if (!data.product) {
    throw new ReviewFetchError('Rainforest response does not contain product data', 'rainforest')
  }

  const product = data.product as Record<string, unknown>
  const topReviews: AmazonReview[] = ((product.top_reviews as Record<string, unknown>[] | undefined) || [])
    .map((review) => ({
      title: asNonEmptyString(review.title) || '(タイトルなし)',
      body: asNonEmptyString(review.body) || '',
      rating: clampRating(asNumber(review.rating) || 3),
      date: asNonEmptyString((review.date as Record<string, unknown> | undefined)?.raw) || todayIsoDate(),
      verified: Boolean(review.verified_purchase),
      helpfulVotes: asNumber(review.helpful_votes) || 0,
    }))
    .filter((review) => review.body)

  if (topReviews.length < 3) {
    throw new ReviewFetchError('Rainforest product endpoint returned too few reviews', 'rainforest')
  }

  return buildReviewCollection({
    asin,
    productName: asNonEmptyString(product.title) || `Amazon商品 ${asin}`,
    totalReviews: asNumber(product.ratings_total) || topReviews.length,
    averageRating: asNumber(product.rating),
    ratingBreakdown: extractRainforestBreakdown(product) || calculateBreakdown(topReviews),
    reviews: topReviews,
    source: 'rainforest',
    warnings: [],
  })
}

async function fetchReviewsFromScraperApi(asin: string): Promise<ReviewCollection> {
  if (!SCRAPERAPI_KEY) {
    throw new ReviewFetchError('SCRAPERAPI_KEY is not set', 'scraperapi')
  }

  const allReviews: AmazonReview[] = []
  const seenReviewKeys = new Set<string>()
  const warnings: string[] = []
  let productName: string | undefined
  let totalReviews: number | undefined
  let averageRating: number | undefined

  for (let page = 1; page <= REVIEW_MAX_PAGES; page += 1) {
    const html = await fetchScraperApiReviewPage(asin, page)
    const parsed = parseAmazonReviewPage(html)

    productName ||= parsed.productName
    totalReviews ||= parsed.totalReviews
    averageRating ||= parsed.averageRating

    if (parsed.reviews.length === 0) {
      warnings.push(`No reviews found on page ${page}`)
      break
    }

    let newReviews = 0
    for (const review of parsed.reviews) {
      const key = buildReviewKey(review)
      if (seenReviewKeys.has(key)) continue
      seenReviewKeys.add(key)
      allReviews.push(review)
      newReviews += 1
    }

    if (newReviews === 0) {
      warnings.push(`Page ${page} returned only duplicate reviews`)
      break
    }

    if (!parsed.hasNextPage) {
      break
    }

    await sleep(REVIEW_REQUEST_DELAY_MS)
  }

  if (allReviews.length === 0) {
    throw new ReviewFetchError('ScraperAPI did not return any parsable reviews', 'scraperapi')
  }

  return buildReviewCollection({
    asin,
    productName: productName || `Amazon商品 ${asin}`,
    totalReviews: totalReviews || allReviews.length,
    averageRating,
    ratingBreakdown: calculateBreakdown(allReviews),
    reviews: allReviews,
    source: 'scraperapi',
    warnings,
  })
}

async function fetchScraperApiReviewPage(asin: string, page: number): Promise<string> {
  const targetUrl = `https://www.amazon.co.jp/product-reviews/${asin}/?pageNumber=${page}&language=ja_JP&sortBy=recent`
  const scraperUrl = new URL('https://api.scraperapi.com/')
  scraperUrl.searchParams.set('api_key', SCRAPERAPI_KEY as string)
  scraperUrl.searchParams.set('url', targetUrl)
  scraperUrl.searchParams.set('country_code', 'jp')
  scraperUrl.searchParams.set('device_type', 'desktop')
  scraperUrl.searchParams.set('keep_headers', 'true')

  const res = await fetchWithRetry(scraperUrl.toString(), 'scraperapi')
  return res.text()
}

function parseAmazonReviewPage(html: string): ParsedReviewPage {
  const $ = load(html)
  const reviews: AmazonReview[] = $('[data-hook="review"]')
    .map((_, element) => {
      const title = extractReviewTitle($, element)
      const body = normalizeWhitespace($(element).find('[data-hook="review-body"]').text())
      const ratingText = normalizeWhitespace(
        $(element).find('[data-hook="review-star-rating"]').first().text()
        || $(element).find('[data-hook="cmps-review-star-rating"]').first().text()
      )
      const date = normalizeWhitespace($(element).find('[data-hook="review-date"]').first().text()) || todayIsoDate()
      const helpfulText = normalizeWhitespace($(element).find('[data-hook="helpful-vote-statement"]').first().text())
      const badgeText = normalizeWhitespace($(element).find('[data-hook="avp-badge"]').first().text())

      if (!body) return null

      return {
        title: title || '(タイトルなし)',
        body,
        rating: clampRating(parseJapaneseNumber(ratingText) || 3),
        date,
        verified: badgeText.includes('Amazonで購入') || normalizeWhitespace($(element).text()).includes('Amazonで購入'),
        helpfulVotes: parseHelpfulVotes(helpfulText),
      } satisfies AmazonReview
    })
    .get()
    .filter((review): review is AmazonReview => Boolean(review))

  const productName = normalizeWhitespace(
    $('#cm_cr-product_info [data-hook="product-link"]').first().text()
    || $('.product-title-word-break').first().text()
    || $('#cm_cr-product_info').first().text()
  )

  const filterInfoText = normalizeWhitespace(
    $('[data-hook="cr-filter-info-review-rating-count"]').first().text()
    || $('#filter-info-section').first().text()
  )

  const averageRatingText = normalizeWhitespace(
    $('[data-hook="rating-out-of-text"]').first().text()
    || $('.averageStarRatingNumerical').first().text()
  )

  const hasNextPage = $('.a-pagination .a-last a').length > 0 && !$('.a-pagination .a-last').hasClass('a-disabled')

  return {
    productName: productName || undefined,
    totalReviews: parseTotalReviews(filterInfoText),
    averageRating: parseJapaneseNumber(averageRatingText) || undefined,
    reviews,
    hasNextPage,
  }
}

function extractReviewTitle($: ReturnType<typeof load>, element: AnyNode): string {
  const titleSpans = $(element)
    .find('[data-hook="review-title"] span')
    .map((_, span) => normalizeWhitespace($(span).text()))
    .get()
    .filter(Boolean)

  return titleSpans[titleSpans.length - 1] || normalizeWhitespace($(element).find('[data-hook="review-title"]').first().text())
}

async function fetchWithRetry(url: string, provider: ReviewSource, attempt = 1): Promise<Response> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REVIEW_REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      throw new ReviewFetchError(`${provider} returned HTTP ${res.status}`, provider)
    }
    return res
  } catch (error) {
    if (attempt >= REVIEW_REQUEST_RETRIES) {
      throw normalizeReviewFetchError(error, provider)
    }

    await sleep(REVIEW_REQUEST_DELAY_MS * attempt)
    return fetchWithRetry(url, provider, attempt + 1)
  }
}

function buildReviewCollection(input: {
  asin: string
  productName: string
  totalReviews: number
  averageRating?: number
  ratingBreakdown: { [key: number]: number }
  reviews: AmazonReview[]
  source: ReviewSource
  warnings: string[]
}): ReviewCollection {
  const lowRatingReviews = input.reviews.filter((review) => review.rating <= 2)
  const highRatingReviews = input.reviews.filter((review) => review.rating >= 4)
  const averageRating = input.averageRating
    || parseFloat((input.reviews.reduce((sum, review) => sum + review.rating, 0) / input.reviews.length).toFixed(1))

  return {
    asin: input.asin,
    productName: input.productName,
    totalReviews: input.totalReviews,
    averageRating,
    ratingBreakdown: input.ratingBreakdown,
    reviews: input.reviews,
    lowRatingReviews,
    highRatingReviews,
    fetchedAt: new Date().toISOString(),
    fetchedCount: input.reviews.length,
    source: input.source,
    warnings: input.warnings,
  }
}

function extractRainforestBreakdown(product: Record<string, unknown>): { [key: number]: number } | null {
  const breakdown = product.rating_breakdown as Record<string, { count?: number }> | undefined
  if (!breakdown) return null

  return {
    5: breakdown.five_star?.count || 0,
    4: breakdown.four_star?.count || 0,
    3: breakdown.three_star?.count || 0,
    2: breakdown.two_star?.count || 0,
    1: breakdown.one_star?.count || 0,
  }
}

function calculateBreakdown(reviews: AmazonReview[]): { [key: number]: number } {
  const breakdown: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  reviews.forEach((review) => {
    breakdown[review.rating] = (breakdown[review.rating] || 0) + 1
  })
  return breakdown
}

function parseTotalReviews(text: string): number | undefined {
  if (!text) return undefined
  const numbers = [...text.matchAll(/([0-9][0-9,]*)/g)]
    .map((match) => Number.parseInt(match[1].replaceAll(',', ''), 10))
    .filter((value) => Number.isFinite(value))

  if (numbers.length === 0) return undefined
  return Math.max(...numbers)
}

function parseHelpfulVotes(text: string): number {
  if (!text) return 0
  if (text.includes('最初のレビュー')) return 0
  return parsePositiveInt(text.match(/([0-9][0-9,]*)/)?.[1], 0)
}

function parseJapaneseNumber(text: string): number | undefined {
  if (!text) return undefined
  const match = text.match(/([0-9]+(?:[.,][0-9]+)?)/)
  if (!match) return undefined
  return Number.parseFloat(match[1].replace(',', '.'))
}

function buildReviewKey(review: AmazonReview): string {
  return [review.title, review.body, review.rating, review.date].join('::')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)))
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value.replaceAll(',', ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0]
}

function normalizeReviewFetchError(error: unknown, provider: ReviewSource | 'unknown'): ReviewFetchError {
  if (error instanceof ReviewFetchError) return error
  if (error instanceof Error) return new ReviewFetchError(error.message, provider)
  return new ReviewFetchError('Unknown review fetch error', provider)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================
// モックデータ（開発用・デモ用）
// 炭酸シャンプーのレビューを模したリアルなデータ
// ============================================

function generateMockReviews(asin: string): ReviewCollection {
  const lowRatingReviews: AmazonReview[] = [
    {
      title: '泡立ちが弱くて残念',
      body: '期待して購入しましたが、泡立ちがかなり弱いです。炭酸シャンプーなのにシュワシュワ感がほとんどありません。洗い上がりもキシキシして、コンディショナーを多めに使わないとダメでした。容量の割に価格が高く、コスパが悪いと感じます。',
      rating: 2,
      date: '2026-02-15',
      verified: true,
      helpfulVotes: 23,
    },
    {
      title: '頭皮がかゆくなった',
      body: '使い始めて3日目から頭皮がかゆくなりました。敏感肌には刺激が強すぎるようです。成分表を見ると硫酸系の界面活性剤が入っていて、これが原因かもしれません。敏感肌の方は注意が必要です。',
      rating: 1,
      date: '2026-02-10',
      verified: true,
      helpfulVotes: 45,
    },
    {
      title: '容量が少なすぎる',
      body: '200mlで3000円は高すぎます。ショートヘアでも2週間で使い切ってしまいました。効果は悪くないと思いますが、毎日使うには経済的に厳しいです。もう少し大容量のものがあれば嬉しいのですが。',
      rating: 2,
      date: '2026-01-28',
      verified: true,
      helpfulVotes: 31,
    },
    {
      title: 'ノズルが使いにくい',
      body: 'ポンプ式ではなくスプレー缶タイプなのですが、出す量の調整が難しいです。一度に大量に出てしまって無駄が多い。ポンプ式にしてほしいです。あと、缶なので旅行時に持ち運びにくいのも難点。',
      rating: 2,
      date: '2026-01-20',
      verified: true,
      helpfulVotes: 18,
    },
    {
      title: '効果を感じられなかった',
      body: '1本使い切りましたが、特に頭皮の状態が改善した実感はありませんでした。抜け毛が減るとか、髪にハリが出るとかの変化はゼロ。普通のシャンプーとの違いがわかりません。広告の謳い文句に期待しすぎたかも。',
      rating: 1,
      date: '2026-01-15',
      verified: true,
      helpfulVotes: 37,
    },
    {
      title: '香りがきつい',
      body: 'ミントの香りが強すぎて、洗った後も数時間残ります。好みが分かれると思います。無香料バージョンがあると良いのですが。シャンプー自体の洗い心地は悪くないだけに残念。',
      rating: 2,
      date: '2026-01-08',
      verified: true,
      helpfulVotes: 12,
    },
    {
      title: '缶の底に残る',
      body: '最後まで使い切れません。振っても出てこなくなりますが、缶を開けると中にまだ結構残っています。もったいない。ポンプボトルに変更してほしい。',
      rating: 2,
      date: '2025-12-25',
      verified: true,
      helpfulVotes: 28,
    },
  ]

  const highRatingReviews: AmazonReview[] = [
    {
      title: '頭皮がスッキリ！リピ確定',
      body: '炭酸の力で頭皮の汚れがしっかり落ちている感じがします。使い始めて1週間で頭皮のベタつきが減りました。美容院でヘッドスパをやった後のようなスッキリ感が自宅で味わえます。特に夏場は手放せなくなりそうです。',
      rating: 5,
      date: '2026-02-20',
      verified: true,
      helpfulVotes: 42,
    },
    {
      title: '髪にハリとコシが出た',
      body: '40代になって髪のボリュームが気になっていましたが、このシャンプーを使い始めてから明らかに髪にハリが出てきました。ドライヤーで乾かした後のふんわり感が全然違います。妻にも「最近髪の調子良いね」と言われました。',
      rating: 5,
      date: '2026-02-12',
      verified: true,
      helpfulVotes: 56,
    },
    {
      title: '爽快感がたまらない',
      body: 'メントールの清涼感と炭酸のシュワシュワ感で、洗髪が毎日の楽しみになりました。特にお風呂上がりの爽快感は他のシャンプーでは味わえません。洗い上がりもサラサラで、トリートメント不要なくらいです。',
      rating: 4,
      date: '2026-02-05',
      verified: true,
      helpfulVotes: 33,
    },
    {
      title: '美容師さんにも褒められた',
      body: '使い始めて1ヶ月後に美容院に行ったら「頭皮の状態がすごく良くなってますね」と言われました。自分でも実感していましたが、プロに認められて嬉しいです。少し高いですが、美容院のヘッドスパ（5000円）を考えれば安いものです。',
      rating: 5,
      date: '2026-01-30',
      verified: true,
      helpfulVotes: 67,
    },
    {
      title: 'フケが減った',
      body: '長年フケに悩んでいましたが、この炭酸シャンプーに変えてから明らかに減りました。完全にゼロではありませんが、黒い服を着ても気にならないレベルに。頭皮の油分バランスが整ったのだと思います。',
      rating: 4,
      date: '2026-01-22',
      verified: true,
      helpfulVotes: 38,
    },
    {
      title: 'コスパは悪くない',
      body: '1回の使用量が少なくて済むので、見た目の容量より長持ちします。3ヶ月使っていますが、2本目の途中です。ヘッドスパに通うことを考えれば十分コスパが良いです。定期便だと少し安くなるのもありがたい。',
      rating: 4,
      date: '2026-01-10',
      verified: true,
      helpfulVotes: 21,
    },
    {
      title: '頭皮の臭いが消えた',
      body: '夕方になると頭皮の臭いが気になっていたのですが、このシャンプーに変えてからほぼ無臭に。仕事中に帽子を被っても臭わなくなりました。炭酸の洗浄力が毛穴の奥の汚れまで落としてくれているのだと思います。',
      rating: 5,
      date: '2025-12-28',
      verified: true,
      helpfulVotes: 44,
    },
    {
      title: '妻と一緒に使っています',
      body: '妻が先に使い始めて「すごく良い」と言うので試してみたら、本当に良かった。夫婦で使えるのが嬉しいポイント。妻は髪のパサつきが改善されたと喜んでいます。私は頭皮のかゆみが減りました。',
      rating: 4,
      date: '2025-12-20',
      verified: true,
      helpfulVotes: 29,
    },
  ]

  const allReviews = [...lowRatingReviews, ...highRatingReviews]

  return {
    asin,
    productName: asin === 'B0DEMOASIN' ? 'シュワッシュ 炭酸シャンプー 200ml' : `Amazon商品 ${asin}`,
    totalReviews: allReviews.length,
    averageRating: parseFloat((allReviews.reduce((sum, review) => sum + review.rating, 0) / allReviews.length).toFixed(1)),
    ratingBreakdown: calculateBreakdown(allReviews),
    reviews: allReviews,
    lowRatingReviews,
    highRatingReviews,
    fetchedAt: new Date().toISOString(),
    fetchedCount: allReviews.length,
    source: 'mock',
    warnings: ['Using mock review data'],
  }
}

/**
 * ASINの形式を検証する（10桁の英数字）
 */
export function validateAsin(input: string): string | null {
  // ASIN: 10桁の英数字（B0から始まる or 数字10桁のISBN）
  const asinMatch = input.match(/\b(B[0-9A-Z]{9}|[0-9]{10})\b/)
  if (asinMatch) return asinMatch[1]

  // Amazon URLからASINを抽出
  const urlMatch = input.match(/amazon\.co\.jp.*?\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/)
  if (urlMatch) return urlMatch[1]

  // amazon.comも対応
  const urlMatch2 = input.match(/amazon\.com.*?\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/)
  if (urlMatch2) return urlMatch2[1]

  return null
}
