import { nativeDeploymentPolicyResponse } from '@/server/authorization/native-deployment-policy'

export async function GET(request: Request) {
  return nativeDeploymentPolicyResponse(request)
}
