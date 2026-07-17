import { ChatExchange, type ChatExchangeProps } from './transcript/ChatExchange'

/** @deprecated Use ChatExchange. Kept while desktop and fixture call sites migrate. */
export type ExchangeBlockProps = ChatExchangeProps

/** @deprecated Use ChatExchange. Kept as a visual no-op compatibility wrapper. */
export function ExchangeBlock(props: ExchangeBlockProps) {
  return <ChatExchange {...props} />
}
