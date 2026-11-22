import { CompareArticle, getCompareMetadata } from '@/features/marketing/compare/CompareArticle'
import { getComparePage } from '@/features/marketing/compare/comparePages'

const page = getComparePage('devin')

export const metadata = getCompareMetadata(page)

export default function DevinComparisonPage() {
  return <CompareArticle page={page} />
}
