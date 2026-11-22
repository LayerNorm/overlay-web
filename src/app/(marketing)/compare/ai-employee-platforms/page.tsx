import { CompareArticle, getCompareMetadata } from '@/features/marketing/compare/CompareArticle'
import { getComparePage } from '@/features/marketing/compare/comparePages'

const page = getComparePage('ai-employee-platforms')

export const metadata = getCompareMetadata(page)

export default function AiEmployeePlatformsPage() {
  return <CompareArticle page={page} />
}
