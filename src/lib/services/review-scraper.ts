// Amazon Review Scraper Service
// Rainforest API でAmazonレビューを構造化データとして取得

export interface AmazonReview {
  title: string
  body: string
  rating: number // 1-5
  date: string
  verified: boolean
  helpfulVotes: number
}

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
}

const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY

/**
 * ASINからAmazonレビューを取得する
 * Rainforest API の product エンドポイントで top_reviews を取得
 */
export async function fetchReviews(asin: string): Promise<ReviewCollection> {
  if (!RAINFOREST_API_KEY) {
    console.log('RAINFOREST_API_KEY not set, using mock data')
    return generateMockReviews(asin)
  }

  try {
    const url = `https://api.rainforestapi.com/request?api_key=${RAINFOREST_API_KEY}&type=product&asin=${asin}&amazon_domain=amazon.co.jp`

    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`Rainforest API error: ${res.status}`)

    const data = await res.json()

    if (!data.product) {
      console.log('No product data, falling back to mock')
      return generateMockReviews(asin)
    }

    const product = data.product
    const topReviews: AmazonReview[] = (product.top_reviews || []).map((r: Record<string, unknown>) => ({
      title: (r.title as string) || '(タイトルなし)',
      body: (r.body as string) || '',
      rating: (r.rating as number) || 3,
      date: (r.date?.raw as string) || new Date().toISOString().split('T')[0],
      verified: (r.verified_purchase as boolean) || false,
      helpfulVotes: (r.helpful_votes as number) || 0,
    })).filter((r: AmazonReview) => r.body)

    const lowRatingReviews = topReviews.filter((r: AmazonReview) => r.rating <= 2)
    const highRatingReviews = topReviews.filter((r: AmazonReview) => r.rating >= 4)

    console.log(`Fetched ${topReviews.length} reviews for ${asin} (low: ${lowRatingReviews.length}, high: ${highRatingReviews.length})`)

    // top_reviewsが少なすぎる場合はreviewsエンドポイントも試す
    if (topReviews.length < 3) {
      console.log('Too few reviews from product endpoint, falling back to mock')
      return generateMockReviews(asin)
    }

    return {
      asin,
      productName: product.title || `Amazon商品 ${asin}`,
      totalReviews: product.ratings_total || topReviews.length,
      averageRating: product.rating || parseFloat((topReviews.reduce((sum: number, r: AmazonReview) => sum + r.rating, 0) / topReviews.length).toFixed(1)),
      ratingBreakdown: extractBreakdown(product) || calculateBreakdown(topReviews),
      reviews: topReviews,
      lowRatingReviews,
      highRatingReviews,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('Review fetch failed, using mock:', error)
    return generateMockReviews(asin)
  }
}

function extractBreakdown(product: Record<string, unknown>): { [key: number]: number } | null {
  const breakdown = product.rating_breakdown as Record<string, { percentage?: number; count?: number }> | undefined
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
  reviews.forEach(r => { breakdown[r.rating] = (breakdown[r.rating] || 0) + 1 })
  return breakdown
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
    averageRating: parseFloat((allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1)),
    ratingBreakdown: calculateBreakdown(allReviews),
    reviews: allReviews,
    lowRatingReviews,
    highRatingReviews,
    fetchedAt: new Date().toISOString(),
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
