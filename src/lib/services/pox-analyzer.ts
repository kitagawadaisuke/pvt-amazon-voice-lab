// POX Framework Analysis Engine
// カスタマーレビューマーケティングの手法をAIで自動化

import { ReviewCollection } from './review-scraper'

// ============================================
// 型定義
// ============================================

export interface CategoryBreakdown {
  category: string
  mentionCount: number
  mentionRate: number // %
  topMentions: string[]
}

export interface CategoryDefinition {
  name: string
  description?: string
}

export interface PoxElement {
  title: string
  description: string
  evidence: string[] // レビューからの引用
  confidence: 'high' | 'medium' | 'low'
  reviewCount?: number // この傾向に該当するレビュー件数
}

export interface PoxAnalysis {
  pod: PoxElement[] // Point of Difference - 独自優位性候補
  pop: PoxElement[] // Point of Parity - 同等性（カテゴリ必須機能）
  pof: PoxElement[] // Point of Failure - 戦略的妥協候補
}

export interface ActionRecommendation {
  category: string
  action: string
  reason: string
}

export interface UnmetNeed {
  need: string
  evidence: string
  importance: 'high' | 'medium' | 'low'
}

export interface ReviewAnalysisReport {
  asin: string
  productName: string
  analyzedAt: string
  categoryFramework: CategoryDefinition[]
  poxGuidance?: string
  analysisDepth?: 'focused' | 'standard' | 'deep'
  notes?: string

  // Step A: レビュー自動分解・構造化
  categoryBreakdown: CategoryBreakdown[]
  totalReviewsAnalyzed: number

  // Step B: POX分析
  poxAnalysis: PoxAnalysis

  // Step C: インサイトサマリー
  painPoints: { title: string; count: number; severity: 'high' | 'medium' | 'low' }[]
  satisfactionPoints: { title: string; count: number }[]
  unmetNeeds: UnmetNeed[]
  priceSentiment: {
    expensive: number // %
    reasonable: number // %
    goodValue: number // %
  }
  actionRecommendations: ActionRecommendation[]

  // モック分析かAI分析か
  isMock?: boolean
}

interface AnalyzeReviewOptions {
  customCategories?: CategoryDefinition[]
  poxGuidance?: string
  analysisDepth?: 'focused' | 'standard' | 'deep'
}

// ============================================
// メインの分析関数
// ============================================

export async function analyzeReviews(
  collection: ReviewCollection,
  userApiKey?: string,
  options: AnalyzeReviewOptions = {}
): Promise<ReviewAnalysisReport> {
  const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return generateMockAnalysis(collection, options)
  }

  try {
    const prompt = buildPoxAnalysisPrompt(collection, options)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: options.analysisDepth === 'deep' ? 5200 : options.analysisDepth === 'focused' ? 3200 : 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    if (!response.ok || !data.content) {
      console.error('Anthropic API error:', JSON.stringify(data, null, 2))
      throw new Error(data.error?.message || `API returned ${response.status}`)
    }
    const text = data.content[0].text
    return parseAIResponse(text, collection, options)
  } catch (error) {
    console.error('POX analysis failed, using mock:', error)
    return generateMockAnalysis(collection, options)
  }
}

function buildCategoryFramework(
  collection: ReviewCollection,
  customCategories?: CategoryDefinition[]
): CategoryDefinition[] {
  if (customCategories && customCategories.length > 0) {
    return customCategories
      .map((category) => ({
        name: category.name.trim(),
        description: category.description?.trim() || '',
      }))
      .filter((category) => category.name)
      .slice(0, 4)
  }

  const sourceText = `${collection.productName} ${collection.asin}`.toLowerCase()

  if (/(cd|dvd|blu-?ray|adapter|adaptor|ケーブル|イヤホン|ヘッドホン|スピーカー|変換)/i.test(sourceText)) {
    return [
      { name: '互換性・対応機器', description: 'どの機器で使えるか、対応条件、非対応条件、利用前の前提条件' },
      { name: '装着・接続性', description: 'はめやすさ、接続しやすさ、手順のわかりやすさ、物理的な扱いやすさ' },
      { name: '再生・動作品質', description: '再生できるか、認識精度、音質や動作安定性、期待通りに機能するか' },
      { name: '価格・コスパ', description: '価格の納得感、コストパフォーマンス、価格に対する品質評価' },
    ]
  }

  if (/(shampoo|conditioner|美容|コスメ|洗顔|頭皮|ヘア|化粧水|乳液)/i.test(sourceText)) {
    return [
      { name: '仕様・成分', description: '容量、成分、香り、容器、購入前に気にする前提情報' },
      { name: '使用感', description: '泡立ち、伸び、刺激、洗い上がり、使っている最中の感覚' },
      { name: '効果実感', description: '継続利用で感じる変化や改善、期待した効果が得られたか' },
      { name: '価格・コスパ', description: '価格の納得感、量に対する価値、継続しやすさ' },
    ]
  }

  if (/(サプリ|食品|飲料|coffee|tea|protein|プロテイン|お菓子)/i.test(sourceText)) {
    return [
      { name: '原材料・仕様', description: '原材料、容量、栄養成分、購入前の前提情報' },
      { name: '味・飲みやすさ', description: '味、香り、飲みやすさ、食べやすさ' },
      { name: '体感・満足度', description: '継続利用で感じる体感、満足度、期待との一致' },
      { name: '価格・続けやすさ', description: '価格の納得感、継続購入しやすさ、コスパ' },
    ]
  }

  if (/(収納|家具|家電|キッチン|掃除|洗濯|バッテリー|ライト)/i.test(sourceText)) {
    return [
      { name: '仕様・サイズ感', description: 'サイズ、重量、設置性、購入前の前提情報' },
      { name: '使いやすさ', description: '操作性、組み立てやすさ、日常利用での扱いやすさ' },
      { name: '性能・耐久性', description: '期待した性能、安定性、壊れにくさ、長持ちするか' },
      { name: '価格・コスパ', description: '価格の納得感、費用対効果、品質とのバランス' },
    ]
  }

  return [
    { name: '商品スペック', description: 'サイズ・素材・対応機種など購入前に確認する仕様情報' },
    { name: '使いやすさ', description: '操作性、扱いやすさ、セットアップの手間' },
    { name: '機能・効果', description: '期待した機能が果たされたか、実際の効果や満足度' },
    { name: '価格・コスパ', description: '価格の納得感、費用対効果' },
  ]
}

// ============================================
// Claude APIプロンプト設計
// ============================================

function buildPoxAnalysisPrompt(collection: ReviewCollection, options: AnalyzeReviewOptions = {}): string {
  const categories = buildCategoryFramework(collection, options.customCategories)
  const lowReviews = collection.lowRatingReviews
    .map((r, i) => `[低評価${i + 1}] ★${r.rating} "${r.title}": ${r.body}`)
    .join('\n\n')

  const highReviews = collection.highRatingReviews
    .map((r, i) => `[高評価${i + 1}] ★${r.rating} "${r.title}": ${r.body}`)
    .join('\n\n')

  const categoryInstructions = categories
    .map((category, index) => `${index + 1}. ${category.name}: ${category.description || '説明なし'}`)
    .join('\n')

  const poxGuidanceBlock = options.poxGuidance?.trim()
    ? `\n## POX分析の追加指示\n${options.poxGuidance.trim()}\n`
    : ''

  const depthInstruction = options.analysisDepth === 'deep'
    ? '分析の深さ: 深掘り。根拠レビューを丁寧に参照し、POD / POP / POF の判断理由を具体的に記述してください。'
    : options.analysisDepth === 'focused'
      ? '分析の深さ: 要点重視。意思決定に必要な要点を簡潔にまとめ、冗長な説明は避けてください。'
      : '分析の深さ: 標準。簡潔さと具体性のバランスを取りながら整理してください。'

  return `あなたはAmazon商品開発のプロフェッショナルコンサルタントです。
「カスタマーレビューマーケティング」の手法に基づき、以下のレビューデータを分析してください。

## 分析対象
商品: ${collection.productName}
ASIN: ${collection.asin}
平均評価: ${collection.averageRating}
分析レビュー数: ${collection.reviews.length}件

## 低評価レビュー（星1-2）
${lowReviews}

## 高評価レビュー（星4-5）
${highReviews}

## 分析カテゴリ定義
${categoryInstructions}
${poxGuidanceBlock}
## 分析の深さ
${depthInstruction}

## 分析指示

以下のJSON形式で回答してください。日本語で記述してください。

{
  "categoryBreakdown": [
    { "category": "${categories[0].name}", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["レビュー本文に実際に出現するキーワード1", "キーワード2", "キーワード3", "キーワード4"] },
    { "category": "${categories[1].name}", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["レビュー本文に実際に出現するキーワード1", "キーワード2", "キーワード3", "キーワード4"] },
    { "category": "${categories[2].name}", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["レビュー本文に実際に出現するキーワード1", "キーワード2", "キーワード3", "キーワード4"] },
    { "category": "${categories[3].name}", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["レビュー本文に実際に出現するキーワード1", "キーワード2", "キーワード3", "キーワード4"] }
  ],
  "poxAnalysis": {
    "pod": [
      { "title": "独自優位性のタイトル", "description": "詳細説明", "evidence": ["レビュー引用1", "レビュー引用2", "レビュー引用3（3〜5件）"], "confidence": "high/medium/low", "reviewCount": この傾向に該当するレビュー件数(数値) }
    ],
    "pop": [
      { "title": "必須機能のタイトル", "description": "詳細説明", "evidence": ["レビュー引用1", "レビュー引用2", "レビュー引用3（3〜5件）"], "confidence": "high/medium/low", "reviewCount": この傾向に該当するレビュー件数(数値) }
    ],
    "pof": [
      { "title": "妥協可能な要素", "description": "詳細説明", "evidence": ["レビュー引用1", "レビュー引用2", "レビュー引用3（3〜5件）"], "confidence": "high/medium/low", "reviewCount": この傾向に該当するレビュー件数(数値) }
    ]
  },
  "painPoints": [
    { "title": "不満のタイトル", "count": 言及数, "severity": "high/medium/low" }
  ],
  "satisfactionPoints": [
    { "title": "満足ポイント", "count": 言及数 }
  ],
  "unmetNeeds": [
    { "need": "具体的な未充足ニーズ", "evidence": "根拠となるレビュー引用や要望の要約", "importance": "high/medium/low" }
  ],
  "priceSentiment": { "expensive": パーセント, "reasonable": パーセント, "goodValue": パーセント },
  "actionRecommendations": [
    { "category": "商品ページ改善/商品設計/訴求改善 のいずれか", "action": "具体的に何をすべきか", "reason": "なぜこのアクションが有効か（レビューのどの声に基づくか）" }
  ] ← 最大3つまで、優先度が高い順に
}

### 分析のポイント:
1. **Pod**: 競合の低評価レビューから「解決すれば差別化になる不満」を特定
2. **POP**: 高評価レビューで繰り返し言及される「このカテゴリで当然あるべき機能」を特定
3. **POF**: 「顧客がそこまで重視していない要素」をコストカット候補として特定
4. **カテゴリ分類**: 指定した4カテゴリの定義に従って必ず分類し、言及率を算出。topMentionsにはレビュー本文に実際に登場する具体的な単語やフレーズを4つ記載すること（抽象的な説明文ではなく「味」「香り」「コスパ」「リピート」等の実キーワード）
5. **未充足ニーズ**: 「〜があれば」「〜だったら」という要望を抽出し、needに具体的な顧客の声を、evidenceにその根拠となるレビューの要約を記述
6. **根拠の重複禁止**: POD/POP/POFの各項目のevidenceには、他の項目で使用済みのレビュー引用を再利用しないこと。全レビューを幅広く参照し、各項目に異なるレビューを根拠として割り当てること`
}

function parseAIResponse(text: string, collection: ReviewCollection, options: AnalyzeReviewOptions = {}): ReviewAnalysisReport {
  try {
    const categoryFramework = buildCategoryFramework(collection, options.customCategories)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const highEvidenceFallback = buildEvidenceSnippets(collection.highRatingReviews)
      const lowEvidenceFallback = buildEvidenceSnippets(collection.lowRatingReviews)
      const allEvidenceFallback = buildEvidenceSnippets(collection.reviews)
      const sanitizedBreakdown = Array.isArray(parsed.categoryBreakdown)
        ? parsed.categoryBreakdown.map((item: CategoryBreakdown) => ({
            ...item,
            mentionCount: typeof item.mentionCount === 'string' ? Math.round(parseFloat(String(item.mentionCount).replace(/[^0-9.]/g, '')) || 0) : (item.mentionCount || 0),
            mentionRate: typeof item.mentionRate === 'string' ? Math.round(parseFloat(String(item.mentionRate).replace(/[^0-9.]/g, '')) || 0) : Math.round(item.mentionRate || 0),
            topMentions: sanitizeMentionList(item.topMentions, categoryFramework.find((category) => category.name === item.category)?.description),
          }))
        : []
      // POX全体で使用済みevidenceを追跡し重複を排除
      const usedEvidence = new Set<string>()
      const dedupeEvidence = (items: PoxElement[], fallbackPool: string[]): PoxElement[] => {
        return (items || []).map((item: PoxElement) => {
          const unusedFallback = fallbackPool.filter((f) => !usedEvidence.has(f))
          const evidence = sanitizeEvidenceList(item.evidence, unusedFallback)
            .filter((e) => !usedEvidence.has(e))
          evidence.forEach((e) => usedEvidence.add(e))
          const reviewCount = typeof item.reviewCount === 'number' ? item.reviewCount : (typeof item.reviewCount === 'string' ? parseInt(String(item.reviewCount).replace(/[^0-9]/g, ''), 10) || undefined : undefined)
          return { ...item, evidence: evidence.length > 0 ? evidence : sanitizeEvidenceList(item.evidence, unusedFallback), reviewCount }
        })
      }

      const sanitizedPox = parsed.poxAnalysis
        ? {
            ...parsed.poxAnalysis,
            pod: dedupeEvidence(parsed.poxAnalysis.pod, highEvidenceFallback),
            pop: dedupeEvidence(parsed.poxAnalysis.pop, allEvidenceFallback),
            pof: dedupeEvidence(parsed.poxAnalysis.pof, lowEvidenceFallback),
          }
        : parsed.poxAnalysis

      const sanitizedUnmetNeeds = Array.isArray(parsed.unmetNeeds)
        ? parsed.unmetNeeds.map((item: UnmetNeed | string) =>
            typeof item === 'string'
              ? { need: item, evidence: '', importance: 'medium' as const }
              : item
          )
        : []

      const sanitizedActions = Array.isArray(parsed.actionRecommendations)
        ? parsed.actionRecommendations.map((item: ActionRecommendation | string) =>
            typeof item === 'string'
              ? { category: '改善施策', action: item, reason: '' }
              : item
          )
        : []

      return {
        asin: collection.asin,
        productName: collection.productName,
        analyzedAt: new Date().toISOString(),
        categoryFramework,
        poxGuidance: options.poxGuidance?.trim() || '',
        analysisDepth: options.analysisDepth || 'standard',
        totalReviewsAnalyzed: collection.reviews.length,
        isMock: false,
        ...parsed,
        categoryBreakdown: sanitizedBreakdown,
        poxAnalysis: sanitizedPox,
        unmetNeeds: sanitizedUnmetNeeds,
        actionRecommendations: sanitizedActions,
      }
    }
  } catch { /* fall through */ }
  return generateMockAnalysis(collection, options)
}

// ============================================
// モックデータ（開発用・デモ用）
// ============================================

function generateMockAnalysis(collection: ReviewCollection, options: AnalyzeReviewOptions = {}): ReviewAnalysisReport {
  const categories = buildCategoryFramework(collection, options.customCategories)
  const reviewCount = Math.max(collection.reviews.length, 1)
  const negativeTitles = uniqueTitles(collection.lowRatingReviews)
  const positiveTitles = uniqueTitles(collection.highRatingReviews)
  const positiveEvidence = buildEvidenceSnippets(collection.highRatingReviews)
  const negativeEvidence = buildEvidenceSnippets(collection.lowRatingReviews)
  const allEvidence = buildEvidenceSnippets(collection.reviews)
  const inferredMentions = inferMentionCandidates(collection)

  const categoryBreakdown = categories.map((category, index) => {
    const baseMentions = Math.max(1, Math.round(reviewCount * (0.7 - index * 0.12)))
    const topMentions = inferredMentions.slice(index, index + 4)

    return {
      category: category.name,
      mentionCount: Math.min(reviewCount, baseMentions),
      mentionRate: Math.max(18, Math.min(95, Math.round((baseMentions / reviewCount) * 100))),
      topMentions: sanitizeMentionList(
        topMentions.length > 0 ? topMentions : [category.description || category.name],
        category.description
      ),
    }
  })

  return {
    asin: collection.asin,
    productName: collection.productName,
    analyzedAt: new Date().toISOString(),
    categoryFramework: categories,
    poxGuidance: options.poxGuidance?.trim() || '',
    analysisDepth: options.analysisDepth || 'standard',
    totalReviewsAnalyzed: collection.reviews.length,
    isMock: true,

    categoryBreakdown,

    poxAnalysis: (() => {
      // モックでもevidence重複を防ぐためプールから順番に取り出す
      const usedMock = new Set<string>()
      const pickEvidence = (pool: string[], count: number, fallbackMsg: string): string[] => {
        const picked = pool.filter((e) => !usedMock.has(e)).slice(0, count)
        picked.forEach((e) => usedMock.add(e))
        return picked.length > 0 ? picked : [fallbackMsg]
      }
      return {
        pod: [
          {
            title: `${categories[2]?.name || '機能・効果'}の満足度`,
            description: `高評価レビューでは「${categories[2]?.name || '機能・効果'}」に関する肯定的な言及が目立ちます。ここを差別化軸として前面に出す余地があります。`,
            evidence: pickEvidence(positiveEvidence, 3, '高評価レビューで繰り返し言及されています'),
            confidence: 'high',
            reviewCount: Math.round(reviewCount * 0.35),
          },
          {
            title: `${categories[1]?.name || '使いやすさ'}の納得感`,
            description: `利用時の扱いやすさや体験品質に関する肯定的な反応が見られます。商品ページでは利用シーンと合わせて具体的に見せるのが有効です。`,
            evidence: pickEvidence(positiveEvidence, 3, '利用体験に関する肯定的な反応が見られます'),
            confidence: 'medium',
            reviewCount: Math.round(reviewCount * 0.2),
          },
        ],
        pop: [
          {
            title: `${categories[0]?.name || '商品スペック'}の明確さ`,
            description: `購入前に確認すべきスペックや仕様は、このカテゴリで最低限満たすべき情報です。商品ページでも誤解なく伝える必要があります。`,
            evidence: pickEvidence(allEvidence, 3, 'レビューで前提条件への言及があります'),
            confidence: 'high',
            reviewCount: Math.round(reviewCount * 0.45),
          },
          {
            title: `${categories[1]?.name || '使いやすさ'}の安定性`,
            description: `実際に使う場面で迷わないこと、期待通りに扱えることはカテゴリの基本要件です。ここで不安を残すと離脱につながります。`,
            evidence: pickEvidence(allEvidence, 3, '利用時の安定性に関する言及があります'),
            confidence: 'medium',
            reviewCount: Math.round(reviewCount * 0.3),
          },
        ],
        pof: [
          {
            title: `${categories[3]?.name || '価格・コスパ'}以外の細部表現`,
            description: `致命的な不満につながっていない細部は、全方位で最適化しきるよりも主要価値の訴求に集中した方が合理的です。`,
            evidence: pickEvidence(negativeEvidence, 3, '一部のレビューで個別要望が見られます'),
            confidence: 'medium',
            reviewCount: Math.round(reviewCount * 0.12),
          },
          {
            title: '周辺要素の過剰最適化',
            description: `主要価値と直接つながらない要素は、レビュー量が十分に増えるまでは優先順位を下げてよい可能性があります。`,
            evidence: pickEvidence(negativeEvidence, 3, '優先度の低い個別要望が見られます'),
            confidence: 'low',
            reviewCount: Math.round(reviewCount * 0.08),
          },
        ],
      }
    })(),

    painPoints: negativeTitles.slice(0, 5).map((title, index) => ({
      title,
      count: Math.max(1, 5 - index),
      severity: index < 2 ? 'high' : index < 4 ? 'medium' : 'low',
    })),

    satisfactionPoints: positiveTitles.slice(0, 5).map((title, index) => ({
      title,
      count: Math.max(1, 6 - index),
    })),

    unmetNeeds: (() => {
      const templates = [
        { need: '商品ページの情報だけでは判断できず、実際に使ってみないとわからないという声', evidence: '「届いてみたら想像と違った」「写真だけではサイズ感がわからない」など、購入前の情報不足への不満が複数見られました。', importance: 'high' as const },
        { need: '長期使用後の耐久性や品質変化についての情報を求める声', evidence: '「半年後にどうなるか知りたい」「長く使えるか不安」など、継続利用に関する情報を求めるレビューがありました。', importance: 'high' as const },
        { need: '類似商品との具体的な違いがわからないという声', evidence: '「他の商品と何が違うのか」「比較情報がほしい」など、競合との差別化ポイントが不明瞭との指摘がありました。', importance: 'medium' as const },
        { need: '使い方のバリエーションや活用シーンをもっと知りたいという声', evidence: '「他にどんな使い方ができるのか」「こういう場面でも使えるか知りたかった」という要望が見られました。', importance: 'low' as const },
      ]
      return templates.slice(0, Math.min(categories.length, templates.length))
    })(),

    priceSentiment: {
      expensive: 30,
      reasonable: 45,
      goodValue: 25,
    },

    actionRecommendations: [
      { category: '商品ページ改善', action: `${categories[0]?.name || '仕様・前提条件'}の前提条件を箇条書きで整理し、購入前の誤解を減らす`, reason: '仕様に関する不満や「思っていたのと違った」という声が多く、情報不足が返品・低評価の原因になっている' },
      { category: '訴求改善', action: `${categories[2]?.name || '主要価値'}に関する高評価の声を商品ページ上部に集約し、何が評価されているかを最短で伝える`, reason: '高評価レビューで繰り返し言及される満足ポイントが、商品ページでは十分に訴求されていない' },
      { category: '商品設計', action: `低評価レビューの上位テーマ「${negativeTitles[0] || '不満点'}」に直結する改善を優先する`, reason: 'この不満テーマが最も多くの低評価に共通しており、改善による評価向上のインパクトが大きい' },
    ],
  }
}

function uniqueTitles(reviews: ReviewCollection['reviews']): string[] {
  return Array.from(new Set(
    reviews
      .map((review) => review.title?.trim())
      .filter((title): title is string => Boolean(title && title !== '(タイトルなし)' && !isNoisyEvidence(title)))
  ))
}

function inferMentionCandidates(collection: ReviewCollection): string[] {
  const source = [
    ...collection.highRatingReviews.flatMap((review) => [review.title, review.body]),
    ...collection.lowRatingReviews.flatMap((review) => [review.title, review.body]),
    ...collection.reviews.slice(0, 8).flatMap((review) => [review.title, review.body]),
  ]
    .join(' ')
    .replace(/[★☆]/g, ' ')

  const matches = source.match(/[A-Za-z0-9.+\-/%]{2,}|[一-龠ぁ-んァ-ヶー]{2,20}/g) || []
  const stopWords = new Set([
    'こと', 'ため', 'よう', 'もの', 'これ', 'それ', 'です', 'ます', 'した', 'して',
    'ある', 'ない', 'いる', 'する', 'なる', 'ので', 'から', 'また', 'ただ', 'でも',
    'with', 'this', 'that',
    'つ星のうち', 'カスタマーレビュー', 'レビュー', 'Amazon', 'amazon', 'co', 'jp',
  ])

  const counts = new Map<string, number>()
  matches.forEach((token) => {
    const value = token.trim()
    if (!value || stopWords.has(value)) return
    if (value.length <= 1) return
    counts.set(value, (counts.get(value) || 0) + 1)
  })

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([token]) => token)
}

function sanitizeMentionList(mentions: string[] | undefined, fallbackText?: string): string[] {
  const cleaned = (mentions || [])
    .map((mention) => mention.trim())
    .filter((mention) => !isNoisyMention(mention))

  if (cleaned.length > 0) {
    return Array.from(new Set(cleaned)).slice(0, 4)
  }

  return fallbackText ? [fallbackText] : ['レビューでの主要言及']
}

function sanitizeEvidenceList(evidence: string[] | undefined, fallback: string[] = []): string[] {
  const cleaned = (evidence || [])
    .map((item) => item.trim())
    .filter((item) => !isNoisyEvidence(item))

  if (cleaned.length > 0) {
    return Array.from(new Set(cleaned)).slice(0, 5)
  }

  return fallback.length > 0 ? fallback.slice(0, 5) : ['代表的なレビュー引用は再分析時に補強されます']
}

function isNoisyMention(value: string): boolean {
  if (!value) return true

  const normalized = value
    .replace(/\s+/g, '')
    .replace(/[★☆]/g, '')
    .toLowerCase()

  if (!normalized) return true
  if (/^\d+(\.\d+)?$/.test(normalized)) return true
  if (/^\d+つ星のうち\d+(\.\d+)?$/.test(normalized)) return true
  if (normalized.includes('つ星のうち')) return true
  if (normalized === 'レビュー' || normalized === 'カスタマーレビュー') return true
  if (normalized === 'amazon' || normalized === 'amazon.co.jp' || normalized === 'co' || normalized === 'jp') return true
  if (normalized.length <= 2) return true
  if (['cd', 'pc', '8cm', '5cm', '4.0', '5.0', '6.35mm', '3.5mm', 'mm', 'cm', 'センチ', 'trs', 'ts'].includes(normalized)) return true

  return false
}

function isNoisyEvidence(value: string): boolean {
  if (!value) return true

  const normalized = value
    .replace(/\s+/g, '')
    .replace(/[★☆]/g, '')
    .toLowerCase()

  if (!normalized) return true
  if (normalized.includes('つ星のうち')) return true
  if (/^\d+(\.\d+)?$/.test(normalized)) return true
  if (value.trim().length < 8) return true

  return false
}

function buildEvidenceSnippets(reviews: ReviewCollection['reviews']): string[] {
  return Array.from(new Set(
    reviews
      .map((review) => toSnippet(review.body))
      .filter((item): item is string => Boolean(item))
  ))
}

function toSnippet(value: string | undefined): string | null {
  if (!value) return null

  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  const firstSentence = normalized.split(/[。.!?]/)[0]?.trim() || normalized
  const snippet = firstSentence.length > 70 ? `${firstSentence.slice(0, 70)}...` : firstSentence
  return isNoisyEvidence(snippet) ? null : snippet
}
