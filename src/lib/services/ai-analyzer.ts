import { DiffResult } from './scraper'

export interface AnalysisResult {
  summary: string
  importance: 'high' | 'medium' | 'low'
  insights: string[]
  recommendedActions: string[]
}

const MOCK_ENABLED = !process.env.ANTHROPIC_API_KEY

export async function analyzeChanges(diff: DiffResult): Promise<AnalysisResult> {
  if (MOCK_ENABLED) {
    return generateMockAnalysis(diff)
  }

  const prompt = buildAnalysisPrompt(diff)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = data.content[0].text
    return parseAIResponse(text, diff)
  } catch (error) {
    console.error('AI analysis failed, using mock:', error)
    return generateMockAnalysis(diff)
  }
}

function buildAnalysisPrompt(diff: DiffResult): string {
  const changesText = diff.changes
    .map(c => {
      if (c.type === 'added') return `[追加] ${c.selector}: "${c.newValue}"`
      if (c.type === 'removed') return `[削除] ${c.selector}: "${c.oldValue}"`
      return `[変更] ${c.selector}: "${c.oldValue}" -> "${c.newValue}"`
    })
    .join('\n')

  return `あなたは競合分析の専門家です。以下のWebサイトの変更を分析してください。

URL: ${diff.url}

検出された変更:
${changesText}

以下のJSON形式で回答してください:
{
  "summary": "変更の要約（日本語、2-3文）",
  "importance": "high/medium/low",
  "insights": ["洞察1", "洞察2"],
  "recommendedActions": ["推奨アクション1", "推奨アクション2"]
}`
}

function parseAIResponse(text: string, diff: DiffResult): AnalysisResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch { /* fall through */ }
  return generateMockAnalysis(diff)
}

function generateMockAnalysis(diff: DiffResult): AnalysisResult {
  const hasPrice = diff.changes.some(c =>
    (c.oldValue?.includes('円') || c.newValue?.includes('円'))
  )
  const hasNewFeature = diff.changes.some(c =>
    c.type === 'added' && (c.newValue?.includes('新') || c.newValue?.includes('リリース'))
  )

  let importance: AnalysisResult['importance'] = 'low'
  if (hasPrice) importance = 'high'
  else if (hasNewFeature) importance = 'medium'

  return {
    summary: `競合サイト（${diff.url}）で${diff.changes.length}件の変更を検出しました。${hasPrice ? '価格変更が含まれています。' : ''}${hasNewFeature ? '新機能のリリースが告知されています。' : ''}`,
    importance,
    insights: [
      hasPrice ? '価格改定は市場ポジショニングの変更を示唆しています' : 'コンテンツの更新が行われました',
      hasNewFeature ? '新機能追加により競争力が強化される可能性があります' : 'UIやメッセージングの改善が行われています',
    ],
    recommendedActions: [
      hasPrice ? '自社の価格戦略を見直してください' : '変更内容を確認し、自社への影響を評価してください',
      '今後1-2週間の動向を注視することをお勧めします',
    ],
  }
}
