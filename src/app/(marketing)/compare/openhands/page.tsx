import { CompareArticle, getCompareMetadata } from '@/features/marketing/compare/CompareArticle'
import { getComparePage } from '@/features/marketing/compare/comparePages'

const page = getComparePage('openhands')

export const metadata = getCompareMetadata(page)

export default function OpenHandsComparisonPage() {
  return <CompareArticle page={page} />
}
