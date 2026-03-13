import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/plans'
import type { Plan } from '@/types/database'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, email, stripe_customer_id')
    .eq('id', user.id)
    .single()

  const plan: Plan = (profile?.plan as Plan) || 'free'

  // 今月の使用回数
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const { count: monthlyUsage } = await supabase
    .from('analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStart)

  const planConfig = PLANS[plan]

  return NextResponse.json({
    user: {
      id: user.id,
      email: profile?.email || user.email,
      plan,
      hasStripe: !!profile?.stripe_customer_id,
    },
    usage: {
      current: monthlyUsage || 0,
      limit: planConfig.monthlyLimit,
    },
    planConfig: {
      compareLimit: planConfig.compareLimit,
      byokAllowed: planConfig.byokAllowed,
      depths: planConfig.depths,
    },
  })
}
