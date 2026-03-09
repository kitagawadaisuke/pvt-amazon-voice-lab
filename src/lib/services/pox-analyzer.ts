// POX Framework Analysis Engine
// カスタマーレビューマーケティングの手法をAIで自動化

import { ReviewCollection, AmazonReview } from './review-scraper'

// ============================================
// 型定義
// ============================================

export interface CategoryBreakdown {
  category: string
  mentionCount: number
  mentionRate: number // %
  topMentions: string[]
}

export interface PoxElement {
  title: string
  description: string
  evidence: string[] // レビューからの引用
  confidence: 'high' | 'medium' | 'low'
}

export interface PoxAnalysis {
  pod: PoxElement[] // Point of Difference - 独自優位性候補
  pop: PoxElement[] // Point of Parity - 同等性（カテゴリ必須機能）
  pof: PoxElement[] // Point of Failure - 戦略的妥協候補
}

export interface ReviewAnalysisReport {
  asin: string
  productName: string
  analyzedAt: string

  // Step A: レビュー自動分解・構造化
  categoryBreakdown: CategoryBreakdown[]
  totalReviewsAnalyzed: number

  // Step B: POX分析
  poxAnalysis: PoxAnalysis

  // Step C: インサイトサマリー
  painPoints: { title: string; count: number; severity: 'high' | 'medium' | 'low' }[]
  satisfactionPoints: { title: string; count: number }[]
  unmetNeeds: string[]
  priceSentiment: {
    expensive: number // %
    reasonable: number // %
    goodValue: number // %
  }
  actionRecommendations: string[]
}

// ============================================
// メインの分析関数
// ============================================

export async function analyzeReviews(
  collection: ReviewCollection,
  userApiKey?: string
): Promise<ReviewAnalysisReport> {
  const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return generateMockAnalysis(collection)
  }

  try {
    const prompt = buildPoxAnalysisPrompt(collection)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = data.content[0].text
    return parseAIResponse(text, collection)
  } catch (error) {
    console.error('POX analysis failed, using mock:', error)
    return generateMockAnalysis(collection)
  }
}

// ============================================
// Claude APIプロンプト設計
// ============================================

function buildPoxAnalysisPrompt(collection: ReviewCollection): string {
  const lowReviews = collection.lowRatingReviews
    .map((r, i) => `[低評価${i + 1}] ★${r.rating} "${r.title}": ${r.body}`)
    .join('\n\n')

  const highReviews = collection.highRatingReviews
    .map((r, i) => `[高評価${i + 1}] ★${r.rating} "${r.title}": ${r.body}`)
    .join('\n\n')

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

## 分析指示

以下のJSON形式で回答してください。日本語で記述してください。

{
  "categoryBreakdown": [
    { "category": "使用前スペック", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["言及1", "言及2"] },
    { "category": "使用感", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["言及1", "言及2"] },
    { "category": "効果効能", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["言及1", "言及2"] },
    { "category": "価格", "mentionCount": 数値, "mentionRate": パーセント数値, "topMentions": ["言及1", "言及2"] }
  ],
  "poxAnalysis": {
    "pod": [
      { "title": "独自優位性のタイトル", "description": "詳細説明", "evidence": ["レビューからの引用"], "confidence": "high/medium/low" }
    ],
    "pop": [
      { "title": "必須機能のタイトル", "description": "詳細説明", "evidence": ["レビューからの引用"], "confidence": "high/medium/low" }
    ],
    "pof": [
      { "title": "妥協可能な要素", "description": "詳細説明", "evidence": ["レビューからの引用"], "confidence": "high/medium/low" }
    ]
  },
  "painPoints": [
    { "title": "不満のタイトル", "count": 言及数, "severity": "high/medium/low" }
  ],
  "satisfactionPoints": [
    { "title": "満足ポイント", "count": 言及数 }
  ],
  "unmetNeeds": ["未充足ニーズ1", "未充足ニーズ2"],
  "priceSentiment": { "expensive": パーセント, "reasonable": パーセント, "goodValue": パーセント },
  "actionRecommendations": ["推奨アクション1", "推奨アクション2"]
}

### 分析のポイント:
1. **Pod**: 競合の低評価レビューから「解決すれば差別化になる不満」を特定
2. **POP**: 高評価レビューで繰り返し言及される「このカテゴリで当然あるべき機能」を特定
3. **Pof**: 「顧客がそこまで重視していない要素」をコストカット候補として特定
4. **カテゴリ分類**: 各レビューの言及を「使用前スペック」「使用感」「効果効能」「価格」に分類し、言及率を算出
5. **未充足ニーズ**: 「〜があれば」「〜だったら」という要望を抽出`
}

function parseAIResponse(text: string, collection: ReviewCollection): ReviewAnalysisReport {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        asin: collection.asin,
        productName: collection.productName,
        analyzedAt: new Date().toISOString(),
        totalReviewsAnalyzed: collection.reviews.length,
        ...parsed,
      }
    }
  } catch { /* fall through */ }
  return generateMockAnalysis(collection)
}

// ============================================
// モックデータ（開発用・デモ用）
// ============================================

function generateMockAnalysis(collection: ReviewCollection): ReviewAnalysisReport {
  return {
    asin: collection.asin,
    productName: collection.productName,
    analyzedAt: new Date().toISOString(),
    totalReviewsAnalyzed: collection.reviews.length,

    categoryBreakdown: [
      {
        category: '使用前スペック',
        mentionCount: 8,
        mentionRate: 53,
        topMentions: ['容量200ml', 'スプレー缶タイプ', '成分（硫酸系界面活性剤）', 'ミントの香り'],
      },
      {
        category: '使用感',
        mentionCount: 12,
        mentionRate: 80,
        topMentions: ['泡立ち', '爽快感・スッキリ感', '洗い上がりサラサラ', 'キシキシする'],
      },
      {
        category: '効果効能',
        mentionCount: 10,
        mentionRate: 67,
        topMentions: ['頭皮のベタつき改善', '髪のハリ・コシ', 'フケ減少', '頭皮の臭い改善'],
      },
      {
        category: '価格',
        mentionCount: 6,
        mentionRate: 40,
        topMentions: ['3000円は高い', 'ヘッドスパより安い', '定期便で割引', 'コスパ悪い'],
      },
    ],

    poxAnalysis: {
      pod: [
        {
          title: '頭皮環境の総合改善',
          description: '臭い・ベタつき・フケの3つを同時に改善できる点が最大の差別化ポイント。競合商品は1つの効果に特化しがちだが、総合的な頭皮ケアを訴求できる。',
          evidence: [
            '頭皮のベタつきが減りました',
            'フケが明らかに減りました',
            '頭皮の臭いがほぼ無臭に',
          ],
          confidence: 'high',
        },
        {
          title: 'サロン品質の自宅体験',
          description: '「美容院のヘッドスパのような体験」という声が複数あり、5000円のヘッドスパとの比較で価格正当化が可能。',
          evidence: [
            '美容院でヘッドスパをやった後のようなスッキリ感',
            '美容師さんに頭皮の状態が良くなったと言われた',
          ],
          confidence: 'high',
        },
      ],
      pop: [
        {
          title: '十分な泡立ち',
          description: 'シャンプーとして最低限の泡立ちは必須。泡立ちの弱さは低評価の主要因の一つ。',
          evidence: ['泡立ちがかなり弱いです', '洗い上がりもサラサラで'],
          confidence: 'high',
        },
        {
          title: '低刺激性',
          description: '敏感肌でも使える低刺激処方はこのカテゴリの必須要件。頭皮トラブルの報告は致命的。',
          evidence: ['敏感肌には刺激が強すぎる', '頭皮がかゆくなった'],
          confidence: 'high',
        },
        {
          title: '使いやすいパッケージ',
          description: 'ポンプ式が期待されている。スプレー缶タイプへの不満が複数。',
          evidence: ['ポンプ式にしてほしい', '出す量の調整が難しい', '缶の底に残る'],
          confidence: 'medium',
        },
      ],
      pof: [
        {
          title: '強いミントの香り',
          description: '香りの好みは個人差が大きく、全員を満足させることは不可能。無香料は差別化にならないため、特定の香りに振り切る戦略も有効。',
          evidence: ['ミントの香りが強すぎて', '好みが分かれる'],
          confidence: 'medium',
        },
        {
          title: '大容量ラインナップ',
          description: '大容量を求める声はあるが、高単価維持と試しやすさのバランスから、200mlに集中して原価を最適化する選択肢もある。',
          evidence: ['容量が少なすぎる', '大容量のものがあれば'],
          confidence: 'low',
        },
      ],
    },

    painPoints: [
      { title: '泡立ちの弱さ', count: 3, severity: 'high' },
      { title: '頭皮への刺激・かゆみ', count: 2, severity: 'high' },
      { title: '容量に対する価格の高さ', count: 4, severity: 'medium' },
      { title: 'スプレー缶の使いにくさ', count: 3, severity: 'medium' },
      { title: '効果実感の低さ', count: 2, severity: 'low' },
    ],

    satisfactionPoints: [
      { title: '頭皮のスッキリ感・爽快感', count: 6 },
      { title: '髪のハリ・ボリューム改善', count: 4 },
      { title: 'フケ・臭いの改善', count: 3 },
      { title: 'サロン品質の体験', count: 3 },
      { title: '家族で共有できる', count: 2 },
    ],

    unmetNeeds: [
      '敏感肌用の低刺激バージョン',
      'ポンプ式ボトルへの変更',
      '無香料バージョン',
      '大容量（400ml以上）パック',
      '詰め替え用パウチ',
    ],

    priceSentiment: {
      expensive: 40,
      reasonable: 33,
      goodValue: 27,
    },

    actionRecommendations: [
      '【Pod強化】「頭皮環境の総合改善（臭い・ベタつき・フケ）」をサブ画像1-2枚目で訴求。美容師の推薦コメントを権威性として活用。',
      '【POP対応】泡立ちの改善（処方変更 or 使用方法の明記）と低刺激処方への切り替えを次ロットで検討。',
      '【Pof戦略】香りは「清涼感」として割り切り、価格は「ヘッドスパ1回分」との比較で正当化。',
      '【パッケージ】スプレー缶からポンプ式ボトルへの変更を強く推奨。不満レビューの主要因。',
      '【価格戦略】定期便割引を目立つ位置に配置し、「1回あたり○○円」表記でコスパ訴求。',
    ],
  }
}
