import type { Plan } from '@/types/database'

export interface PlanConfig {
  name: string
  monthlyLimit: number
  byokAllowed: boolean
  compareLimit: number
  depths: string[]
  price: number // 月額（円）
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: {
    name: 'Free',
    monthlyLimit: 3,
    byokAllowed: false,
    compareLimit: 2,
    depths: ['standard'],
    price: 0,
  },
  standard: {
    name: 'Standard',
    monthlyLimit: 30,
    byokAllowed: true,
    compareLimit: 5,
    depths: ['standard', 'focused', 'deep'],
    price: 980,
  },
}

/**
 * 使用量チェック結果
 * - allowed: サービス側キーで実行可能
 * - byok_required: 上限超過だがBYOKで継続可能（Standard限定）
 * - limit_reached: 上限到達、これ以上不可（Free）
 * - byok_not_allowed: FreeユーザーがBYOKを使おうとした
 */
export type UsageCheckResult =
  | { status: 'allowed' }
  | { status: 'byok_required' }
  | { status: 'limit_reached'; limit: number }
  | { status: 'byok_not_allowed' }

export function checkUsage(
  plan: Plan,
  currentMonthUsage: number,
  hasByok: boolean
): UsageCheckResult {
  const config = PLANS[plan]

  // FreeユーザーがBYOKを使おうとした場合
  if (hasByok && !config.byokAllowed) {
    return { status: 'byok_not_allowed' }
  }

  // 上限内 → サービス側キーで実行
  if (currentMonthUsage < config.monthlyLimit) {
    return { status: 'allowed' }
  }

  // 上限超過
  if (config.byokAllowed) {
    // Standard: BYOKで無制限継続可能
    return { status: 'byok_required' }
  }

  // Free: 上限到達で打ち止め
  return { status: 'limit_reached', limit: config.monthlyLimit }
}
