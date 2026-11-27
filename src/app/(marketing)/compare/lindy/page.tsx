import { CompareArticle, getCompareMetadata } from '@/features/marketing/compare/CompareArticle'
import { getComparePage } from '@/features/marketing/compare/comparePages'

const page = getComparePage('lindy')

export const metadata = getCompareMetadata(page)

export default function LindyComparisonPage() {
  return <CompareArticle page={page} />
}
