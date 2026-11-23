import { CompareArticle, getCompareMetadata } from '@/features/marketing/compare/CompareArticle'
import { getComparePage } from '@/features/marketing/compare/comparePages'

const page = getComparePage('devin-alternatives')

export const metadata = getCompareMetadata(page)

export default function DevinAlternativesPage() {
  return <CompareArticle page={page} />
}
