import 'server-only'

export type BillingProviderEventReservation =
  | { status: 'acquired'; attempt: number }
  | { status: 'duplicate'; processed: boolean }

export interface BillingProviderEventRepository {
  reserve(args: {
    eventId: string
    eventType: string
    payloadHash: string
    provider: string
  }): Promise<BillingProviderEventReservation>
  markProcessed(args: { eventId: string; provider: string }): Promise<void>
  markFailed(args: { error: string; eventId: string; provider: string }): Promise<void>
}

export interface BillingWebhookRepository {
  resolveUserIdByProviderReference(args: {
    provider: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null>
}
